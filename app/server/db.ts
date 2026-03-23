import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type {
  SessionMessage,
  SessionWithProject,
} from './domains/sessions/schema'
import { env } from './env'
import serverEvents from './lib/events'
import { log } from './logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.join(__dirname, '../../schema.sql')

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
})

// Initialize database from schema.sql
export async function initDb() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    log.error(`[db] Schema file not found: ${SCHEMA_PATH}`)
    process.exit(1)
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')

  try {
    await pool.query(schema)
  } catch (err: unknown) {
    // In dev mode, auto-create the database if it doesn't exist (code 3D000)
    if (
      env.NODE_ENV === 'development' &&
      err instanceof Error &&
      (err as { code?: string }).code === '3D000'
    ) {
      const dbUrl = new URL(env.DATABASE_URL)
      const dbName = dbUrl.pathname.slice(1)
      log.info(`[db] Database "${dbName}" does not exist, creating...`)

      dbUrl.pathname = '/postgres'
      const adminClient = new pg.Client({ connectionString: dbUrl.toString() })
      try {
        await adminClient.connect()
        await adminClient.query(
          `CREATE DATABASE "${dbName.replace(/"/g, '""')}"`,
        )
        log.info(`[db] Created database "${dbName}"`)
      } finally {
        await adminClient.end()
      }

      await pool.query(schema)
    } else {
      throw err
    }
  }

  log.info('[db] Database initialized from schema.sql')

  serverEvents.emit('db:initialized')

  // Cleanup general logs older than 1 week
  const logsResult = await pool.query(`
    DELETE FROM logs WHERE created_at < NOW() - INTERVAL '1 week'
  `)
  if (logsResult.rowCount && logsResult.rowCount > 0) {
    log.info(`[db] Cleaned up ${logsResult.rowCount} logs`)
  }
}

export async function updateSessionMove(
  sessionId: string,
  projectId: number,
  terminalId: number,
  transcriptPath: string,
  client?: pg.PoolClient,
): Promise<boolean> {
  const db = client ?? pool
  const result = await db.query(
    `UPDATE sessions SET project_id = $1, terminal_id = $2, transcript_path = $3, updated_at = NOW() WHERE session_id = $4`,
    [projectId, terminalId, transcriptPath, sessionId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Session backfill queries

export async function getSessionTranscriptPaths(
  encodedPath: string,
): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT transcript_path FROM sessions WHERE transcript_path LIKE $1`,
    [`%${encodedPath}%`],
  )
  return rows.map((r: { transcript_path: string }) => r.transcript_path)
}

export async function insertBackfilledSession(
  sessionId: string,
  projectId: number,
  terminalId: number,
  shellId: number,
  transcriptPath: string,
  timestamp: string | null,
  client?: pg.PoolClient,
): Promise<void> {
  const db = client ?? pool
  const { rowCount } = await db.query(
    timestamp
      ? `INSERT INTO sessions (session_id, project_id, terminal_id, shell_id, status, transcript_path, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ended', $5, $6, $6)
         ON CONFLICT (session_id) DO NOTHING`
      : `INSERT INTO sessions (session_id, project_id, terminal_id, shell_id, status, transcript_path)
         VALUES ($1, $2, $3, $4, 'ended', $5)
         ON CONFLICT (session_id) DO NOTHING`,
    timestamp
      ? [sessionId, projectId, terminalId, shellId, transcriptPath, timestamp]
      : [sessionId, projectId, terminalId, shellId, transcriptPath],
  )
  // Create a prompt row so worker.py's process_transcript() can attach messages
  if (rowCount && rowCount > 0) {
    await db.query(`INSERT INTO prompts (session_id) VALUES ($1)`, [sessionId])
  }
}

// Active permissions query

export interface ActivePermission extends SessionWithProject {
  message_id: number
  source: 'ask_user_question' | 'terminal_prompt'
  tools: Record<string, unknown>
}

export async function getActivePermissions(): Promise<ActivePermission[]> {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (s.session_id)
      s.*,
      proj.path as project_path,
      (
        SELECT pr2.prompt FROM prompts pr2
        WHERE pr2.session_id = s.session_id AND pr2.prompt IS NOT NULL
        ORDER BY pr2.created_at DESC LIMIT 1
      ) as latest_user_message,
      (
        SELECT m2.body FROM messages m2
        JOIN prompts pr2 ON m2.prompt_id = pr2.id
        WHERE pr2.session_id = s.session_id
          AND m2.is_user = false
          AND m2.tools IS NULL
        ORDER BY m2.created_at DESC LIMIT 1
      ) as latest_agent_message,
      m.id as message_id,
      m.tools as tools
    FROM sessions s
    JOIN projects proj ON s.project_id = proj.id
    JOIN prompts p ON p.session_id = s.session_id
    JOIN messages m ON m.prompt_id = p.id
    WHERE s.status = 'permission_needed'
      AND m.is_user = false
      AND m.tools IS NOT NULL
      AND (
        (m.tools->>'name' = 'AskUserQuestion'
          AND m.tools->'answers' IS NULL
          AND m.tools->>'status' IS DISTINCT FROM 'error')
        OR (m.tools->>'name' = 'PermissionPrompt' AND m.tools->>'status' = 'pending')
      )
      AND p.id = (
        SELECT p2.id FROM prompts p2
        WHERE p2.session_id = s.session_id
        ORDER BY p2.created_at DESC LIMIT 1
      )
      AND m.created_at >= p.created_at
    ORDER BY s.session_id, m.created_at DESC
  `)

  return rows.map((row) => ({
    ...row,
    is_favorite: false,
    source:
      row.tools?.name === 'AskUserQuestion'
        ? ('ask_user_question' as const)
        : ('terminal_prompt' as const),
  }))
}

// Permission prompt helpers

export async function getLatestPromptId(
  sessionId: string,
): Promise<number | null> {
  const { rows } = await pool.query(
    'SELECT id FROM prompts WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sessionId],
  )
  return rows[0]?.id ?? null
}

export async function insertPermissionMessage(
  promptId: number,
  uuid: string,
  toolsJson: string,
): Promise<SessionMessage> {
  const { rows } = await pool.query(
    `INSERT INTO messages (prompt_id, uuid, is_user, thinking, tools)
     VALUES ($1, $2, FALSE, FALSE, $3)
     RETURNING *`,
    [promptId, uuid, toolsJson],
  )
  // Fetch with prompt_text for SessionMessage shape
  const { rows: full } = await pool.query(
    `SELECT m.*, p.prompt as prompt_text
     FROM messages m JOIN prompts p ON m.prompt_id = p.id
     WHERE m.id = $1`,
    [rows[0].id],
  )
  return full[0]
}

export default pool
