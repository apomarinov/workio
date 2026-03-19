import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOrphanedCommandLogs } from '@domains/logs/db'
import pg from 'pg'
import type { SessionSearchMatch, SessionWithProject } from '../src/types'
import { env } from './env'
import { buildSetClauses } from './lib/db'
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

  await cleanupOrphanedCommandLogs()

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

// Session queries

const SESSION_SELECT = `
  SELECT
    s.*,
    p.path as project_path,
    (
      SELECT pr.prompt FROM prompts pr
      WHERE pr.session_id = s.session_id AND pr.prompt IS NOT NULL
      ORDER BY pr.created_at DESC LIMIT 1
    ) as latest_user_message,
    (
      SELECT m.body FROM messages m
      JOIN prompts pr ON m.prompt_id = pr.id
      WHERE pr.session_id = s.session_id
        AND m.is_user = false
        AND m.tools IS NULL
      ORDER BY m.created_at DESC LIMIT 1
    ) as latest_agent_message
  FROM sessions s
  JOIN projects p ON s.project_id = p.id
`

export async function getAllSessions(): Promise<SessionWithProject[]> {
  const { rows } = await pool.query(
    `${SESSION_SELECT} ORDER BY s.updated_at DESC`,
  )
  return rows
}

export async function getSessionById(
  sessionId: string,
): Promise<SessionWithProject | undefined> {
  const { rows } = await pool.query(
    `${SESSION_SELECT} WHERE s.session_id = $1`,
    [sessionId],
  )
  return rows[0]
}

export interface SessionMessage {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  todo_id: string | null
  body: string | null
  tools: Record<string, unknown> | null
  images: unknown[] | null
  created_at: string
  updated_at: string | null
  prompt_text: string | null
}

export interface SessionMessagesResult {
  messages: SessionMessage[]
  total: number
  hasMore: boolean
}

export async function getSessionMessages(
  sessionId: string,
  limit: number,
  offset: number,
): Promise<SessionMessagesResult> {
  const countResult = await pool.query(
    `
      SELECT COUNT(*) as count
      FROM messages m
      JOIN prompts p ON m.prompt_id = p.id
      WHERE p.session_id = $1
    `,
    [sessionId],
  )
  const total = Number.parseInt(countResult.rows[0].count, 10)

  const { rows } = await pool.query(
    `
      SELECT
        m.id,
        m.prompt_id,
        m.uuid,
        m.is_user,
        m.thinking,
        m.todo_id,
        m.body,
        m.tools,
        m.images,
        m.created_at,
        m.updated_at,
        p.prompt as prompt_text
      FROM messages m
      JOIN prompts p ON m.prompt_id = p.id
      WHERE p.session_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [sessionId, limit, offset],
  )

  // PostgreSQL JSONB returns native objects — no JSON.parse needed
  // PostgreSQL BOOLEAN returns native booleans — no conversion needed
  return {
    messages: rows,
    total,
    hasMore: offset + rows.length < total,
  }
}

export async function getMessagesByIds(
  ids: number[],
): Promise<SessionMessage[]> {
  if (ids.length === 0) return []

  const { rows } = await pool.query(
    `
      SELECT
        m.id,
        m.prompt_id,
        m.uuid,
        m.is_user,
        m.thinking,
        m.todo_id,
        m.body,
        m.tools,
        m.images,
        m.created_at,
        m.updated_at,
        p.prompt as prompt_text
      FROM messages m
      JOIN prompts p ON m.prompt_id = p.id
      WHERE m.id = ANY($1)
      ORDER BY m.id
    `,
    [ids],
  )
  return rows
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string },
): Promise<boolean> {
  const set = buildSetClauses({ name: updates.name })
  if (!set) return true

  set.values.push(sessionId)
  const result = await pool.query(
    `UPDATE sessions SET ${set.sql} WHERE session_id = $${set.nextParam}`,
    set.values,
  )
  return (result.rowCount ?? 0) > 0
}

export async function updateSessionData(
  sessionId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sessions SET data = COALESCE(data, '{}'::jsonb) || $1::jsonb WHERE session_id = $2`,
    [JSON.stringify(data), sessionId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function setActiveSessionDone(
  shellId: number,
): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE sessions SET status = 'done', updated_at = NOW()
     WHERE shell_id = $1 AND status in ('permission_needed', 'active')
     RETURNING session_id`,
    [shellId],
  )
  return rows[0]?.session_id ?? null
}

export async function resumePermissionSession(
  shellId: number,
): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE sessions SET status = 'active', updated_at = NOW()
     WHERE shell_id = $1 AND status = 'permission_needed'
     RETURNING session_id`,
    [shellId],
  )
  return rows[0]?.session_id ?? null
}

async function deleteSessionCascade(sessionIds: string[]): Promise<number> {
  if (sessionIds.length === 0) return 0

  // Delete in order: messages (via prompts), prompts, hooks, then sessions
  const promptResult = await pool.query(
    'SELECT id FROM prompts WHERE session_id = ANY($1)',
    [sessionIds],
  )
  if (promptResult.rows.length > 0) {
    const ids = promptResult.rows.map((p: { id: number }) => p.id)
    await pool.query('DELETE FROM messages WHERE prompt_id = ANY($1)', [ids])
  }
  await pool.query('DELETE FROM prompts WHERE session_id = ANY($1)', [
    sessionIds,
  ])
  await pool.query('DELETE FROM hooks WHERE session_id = ANY($1)', [sessionIds])
  const result = await pool.query(
    'DELETE FROM sessions WHERE session_id = ANY($1)',
    [sessionIds],
  )
  return result.rowCount ?? 0
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  return (await deleteSessionCascade([sessionId])) > 0
}

export async function getOldSessionIds(
  weeks: number,
  excludeIds: string[],
): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT session_id FROM sessions
     WHERE updated_at < NOW() - INTERVAL '1 week' * $1
       AND session_id != ALL($2)`,
    [weeks, excludeIds],
  )
  return rows.map((r: { session_id: string }) => r.session_id)
}

export async function deleteSessions(sessionIds: string[]): Promise<number> {
  return deleteSessionCascade(sessionIds)
}

export async function searchSessionMessages(
  query: string | null,
  limit = 100,
  filters?: { repo?: string; branch?: string },
  recentOnly = true,
): Promise<SessionSearchMatch[]> {
  const hasTextQuery = query != null && query.length >= 2
  const hasFilters = filters?.repo != null && filters?.branch != null

  if (!hasTextQuery && !hasFilters) return []

  // Build optional containment filter fragment
  const containmentParam: string[] = []
  if (hasFilters) {
    const containment: Record<string, string> = {
      repo: filters.repo!,
      branch: filters.branch!,
    }
    containmentParam.push(JSON.stringify([containment]))
  }

  const recentClause = recentOnly
    ? `s.updated_at >= NOW() - INTERVAL '10 days'`
    : ''

  type SessionRow = {
    session_id: string
    name: string | null
    status: string
    terminal_id: number | null
    updated_at: string
    data: Record<string, unknown> | null
    project_path: string
    terminal_name: string | null
  }

  // Filter-only: single query on sessions
  if (!hasTextQuery) {
    const conditions = [`s.data->'branches' @> $1::jsonb`]
    if (recentClause) conditions.push(recentClause)
    const { rows } = await pool.query<SessionRow>(
      `
      SELECT s.session_id, s.name, s.status, s.terminal_id, s.updated_at, s.data,
             p.path as project_path, t.name as terminal_name
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN terminals t ON s.terminal_id = t.id
      WHERE ${conditions.join(' AND ')}
      `,
      containmentParam,
    )
    return buildResults(rows, new Map())
  }

  // Text search: 2 queries in parallel
  // Query 1: message body ILIKE + session info (+ optional containment filter)
  const msgConditions = [
    'm.body ILIKE $1',
    'm.thinking = false',
    'm.body IS NOT NULL',
  ]
  if (recentClause) msgConditions.push(recentClause)
  const msgParams: unknown[] = [`%${query}%`, limit]
  let msgParamIdx = 3
  if (hasFilters) {
    msgConditions.push(`s.data->'branches' @> $${msgParamIdx++}::jsonb`)
    msgParams.push(containmentParam[0])
  }

  // Query 2: session name/branch ILIKE + session info (+ optional containment filter)
  const nameConditions = [`(s.name ILIKE $1 OR s.data->>'branch' ILIKE $1)`]
  if (recentClause) nameConditions.push(recentClause)
  const nameParams: unknown[] = [`%${query}%`, limit]
  let nameParamIdx = 3
  if (hasFilters) {
    nameConditions.push(`s.data->'branches' @> $${nameParamIdx++}::jsonb`)
    nameParams.push(containmentParam[0])
  }

  const [{ rows: msgRows }, { rows: nameRows }] = await Promise.all([
    pool.query<
      SessionRow & { message_id: number; body: string; is_user: boolean }
    >(
      `
      SELECT m.id as message_id, m.body, m.is_user,
             s.session_id, s.name, s.status, s.terminal_id, s.updated_at, s.data,
             p.path as project_path, t.name as terminal_name
      FROM messages m
      JOIN prompts pr ON m.prompt_id = pr.id
      JOIN sessions s ON pr.session_id = s.session_id
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN terminals t ON s.terminal_id = t.id
      WHERE ${msgConditions.join(' AND ')}
      ORDER BY m.created_at DESC
      LIMIT $2
      `,
      msgParams,
    ),
    pool.query<SessionRow>(
      `
      SELECT s.session_id, s.name, s.status, s.terminal_id, s.updated_at, s.data,
             p.path as project_path, t.name as terminal_name
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN terminals t ON s.terminal_id = t.id
      WHERE ${nameConditions.join(' AND ')}
      LIMIT $2
      `,
      nameParams,
    ),
  ])

  // Group messages per session (cap 5)
  const sessionMessages = new Map<
    string,
    { id: number; body: string; is_user: boolean }[]
  >()
  const sessionInfoMap = new Map<string, SessionRow>()

  for (const row of msgRows) {
    if (!sessionInfoMap.has(row.session_id))
      sessionInfoMap.set(row.session_id, row)
    const msgs = sessionMessages.get(row.session_id) || []
    if (msgs.length < 5) {
      msgs.push({ id: row.message_id, body: row.body, is_user: row.is_user })
    }
    sessionMessages.set(row.session_id, msgs)
  }

  // Merge name-matched sessions (empty messages if not already present)
  for (const row of nameRows) {
    if (!sessionInfoMap.has(row.session_id))
      sessionInfoMap.set(row.session_id, row)
    if (!sessionMessages.has(row.session_id)) {
      sessionMessages.set(row.session_id, [])
    }
  }

  return buildResults([...sessionInfoMap.values()], sessionMessages)
}

function buildResults(
  sessionRows: {
    session_id: string
    name: string | null
    status: string
    terminal_id: number | null
    updated_at: string
    data: Record<string, unknown> | null
    project_path: string
    terminal_name: string | null
  }[],
  sessionMessages: Map<
    string,
    { id: number; body: string; is_user: boolean }[]
  >,
): SessionSearchMatch[] {
  const results: SessionSearchMatch[] = sessionRows.map((info) => ({
    session_id: info.session_id,
    name: info.name,
    terminal_name: info.terminal_name,
    project_path: info.project_path,
    status: info.status,
    updated_at: info.updated_at,
    data: info.data ?? null,
    messages: sessionMessages.get(info.session_id) ?? [],
  }))

  results.sort((a, b) => {
    const aInfo = sessionRows.find((r) => r.session_id === a.session_id)!
    const bInfo = sessionRows.find((r) => r.session_id === b.session_id)!
    const aHasTerminal = aInfo.terminal_id != null ? 0 : 1
    const bHasTerminal = bInfo.terminal_id != null ? 0 : 1
    if (aHasTerminal !== bHasTerminal) return aHasTerminal - bHasTerminal
    return (
      new Date(bInfo.updated_at).getTime() -
      new Date(aInfo.updated_at).getTime()
    )
  })

  return results
}

// Settings — re-exported from domain
export { getSettings, updateSettings } from '@domains/settings/db'

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

export async function getMessageByUuid(
  uuid: string,
): Promise<SessionMessage | null> {
  const { rows } = await pool.query(
    `SELECT m.*, p.prompt as prompt_text
     FROM messages m JOIN prompts p ON m.prompt_id = p.id
     WHERE m.uuid = $1`,
    [uuid],
  )
  return rows[0] ?? null
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
