import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { UnreadPRNotification } from '../shared/types'
import type {
  Project,
  SessionSearchMatch,
  SessionWithProject,
  Settings,
  Shell,
  Terminal,
} from '../src/types'
import { DEFAULT_KEYMAP } from '../src/types'
import { env } from './env'
import { log } from './logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.join(__dirname, '../../schema.sql')
const WORKIO_TERMINALS_DIR = path.join(os.homedir(), '.workio', 'terminals')

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
})

// Initialize database from schema.sql
export async function initDb() {
  if (fs.existsSync(SCHEMA_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
    await pool.query(schema)
    log.info('[db] Database initialized from schema.sql')
  } else {
    log.error(`[db] Schema file not found: ${SCHEMA_PATH}`)
    process.exit(1)
  }

  // Cleanup orphaned command_logs older than 1 week (terminal no longer exists)
  const orphanedResult = await pool.query(`
    DELETE FROM command_logs
    WHERE terminal_id IS NOT NULL
      AND terminal_id NOT IN (SELECT id FROM terminals)
      AND created_at < NOW() - INTERVAL '1 week'
  `)
  if (orphanedResult.rowCount && orphanedResult.rowCount > 0) {
    log.info(`[db] Cleaned up ${orphanedResult.rowCount} orphaned command_logs`)
  }

  // Cleanup general logs older than 1 week
  const logsResult = await pool.query(`
    DELETE FROM logs WHERE created_at < NOW() - INTERVAL '1 week'
  `)
  if (logsResult.rowCount && logsResult.rowCount > 0) {
    log.info(`[db] Cleaned up ${logsResult.rowCount} logs`)
  }
}

// Project queries

export async function getProjectByPath(
  cwd: string,
): Promise<Project | undefined> {
  const { rows } = await pool.query('SELECT * FROM projects WHERE path = $1', [
    cwd,
  ])
  return rows[0]
}

export async function getProjectById(id: number): Promise<Project | undefined> {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [
    id,
  ])
  return rows[0]
}

export async function upsertProject(
  projectPath: string,
  client?: pg.PoolClient,
): Promise<number> {
  const db = client ?? pool
  const { rows } = await db.query(
    `INSERT INTO projects (path) VALUES ($1)
     ON CONFLICT (path) DO UPDATE SET path = EXCLUDED.path
     RETURNING id`,
    [projectPath],
  )
  return rows[0].id
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
  const setClauses: string[] = []
  const values: (string | null)[] = []
  let paramIdx = 1

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`)
    values.push(updates.name)
  }

  if (setClauses.length === 0) {
    return true
  }

  setClauses.push('updated_at = NOW()')
  values.push(sessionId)

  const result = await pool.query(
    `UPDATE sessions SET ${setClauses.join(', ')} WHERE session_id = $${paramIdx}`,
    values,
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

export async function deleteSession(sessionId: string): Promise<boolean> {
  // Delete in order: messages (via prompts), prompts, hooks, then session
  const promptResult = await pool.query(
    'SELECT id FROM prompts WHERE session_id = $1',
    [sessionId],
  )

  if (promptResult.rows.length > 0) {
    const ids = promptResult.rows.map((p: { id: number }) => p.id)
    await pool.query('DELETE FROM messages WHERE prompt_id = ANY($1)', [ids])
  }

  await pool.query('DELETE FROM prompts WHERE session_id = $1', [sessionId])
  await pool.query('DELETE FROM hooks WHERE session_id = $1', [sessionId])
  const result = await pool.query(
    'DELETE FROM sessions WHERE session_id = $1',
    [sessionId],
  )
  return (result.rowCount ?? 0) > 0
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
  if (sessionIds.length === 0) return 0
  let deleted = 0
  for (const sessionId of sessionIds) {
    if (await deleteSession(sessionId)) deleted++
  }
  return deleted
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

// Terminal queries

async function attachShellsToTerminals(
  terminals: Terminal[],
): Promise<Terminal[]> {
  if (terminals.length === 0) return terminals
  const ids = terminals.map((t) => t.id)
  const { rows: shells } = await pool.query(
    'SELECT * FROM shells WHERE terminal_id = ANY($1) ORDER BY id',
    [ids],
  )
  const shellsByTerminal = new Map<number, Shell[]>()
  for (const s of shells) {
    const list = shellsByTerminal.get(s.terminal_id) || []
    list.push(s)
    shellsByTerminal.set(s.terminal_id, list)
  }
  for (const t of terminals) {
    t.shells = shellsByTerminal.get(t.id) || []
  }
  return terminals
}

export async function getAllTerminals(): Promise<Terminal[]> {
  const { rows } = await pool.query(`
    SELECT * FROM terminals
    ORDER BY created_at DESC
  `)
  return attachShellsToTerminals(rows)
}

export async function getTerminalById(
  id: number,
): Promise<Terminal | undefined> {
  const { rows } = await pool.query(
    `
    SELECT * FROM terminals WHERE id = $1
  `,
    [id],
  )
  if (rows.length === 0) return undefined
  const [terminal] = await attachShellsToTerminals(rows)
  return terminal
}

// Generate unique terminal name by appending -1, -2, etc. if name exists
async function getUniqueTerminalName(
  baseName: string,
  excludeId?: number,
): Promise<string> {
  let name = baseName
  let suffix = 1
  while (suffix < 200) {
    const { rows } = await pool.query(
      excludeId
        ? 'SELECT id FROM terminals WHERE name = $1 AND id != $2'
        : 'SELECT id FROM terminals WHERE name = $1',
      excludeId ? [name, excludeId] : [name],
    )
    if (rows.length === 0) return name
    name = `${baseName}-${suffix++}`
  }
  return `${baseName}-${crypto.randomUUID().slice(0, 4)}`
}

// Check if terminal name already exists (for validation)
export async function terminalNameExists(
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    excludeId
      ? 'SELECT id FROM terminals WHERE name = $1 AND id != $2'
      : 'SELECT id FROM terminals WHERE name = $1',
    excludeId ? [name, excludeId] : [name],
  )
  return rows.length > 0
}

export async function createTerminal(
  cwd: string,
  name: string | null,
  shell: string | null = null,
  ssh_host: string | null = null,
  git_repo: object | null = null,
  setup: object | null = null,
  settings: object | null = null,
): Promise<Terminal> {
  // Auto-generate unique name if provided
  const uniqueName = name ? await getUniqueTerminalName(name) : null

  const { rows } = await pool.query(
    `
    INSERT INTO terminals (cwd, name, shell, ssh_host, git_repo, setup, settings)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
    [
      cwd,
      uniqueName,
      shell,
      ssh_host,
      git_repo ? JSON.stringify(git_repo) : null,
      setup ? JSON.stringify(setup) : null,
      settings ? JSON.stringify(settings) : null,
    ],
  )
  const terminal = rows[0] as Terminal

  // Auto-create main shell
  const { rows: shellRows } = await pool.query(
    `INSERT INTO shells (terminal_id, name) VALUES ($1, 'main') RETURNING *`,
    [terminal.id],
  )
  terminal.shells = shellRows

  return terminal
}

export async function updateTerminal(
  id: number,
  updates: {
    name?: string
    cwd?: string
    pid?: number | null
    status?: string
    git_branch?: string | null
    git_repo?: object | null
    setup?: object | null
    settings?: object | null
  },
): Promise<Terminal | undefined> {
  // Get old terminal if name is changing (for zellij session rename)
  let oldName: string | null = null
  if (updates.name !== undefined) {
    const oldTerminal = await getTerminalById(id)
    oldName = oldTerminal?.name || null
  }

  const setClauses: string[] = []
  const values: (string | number | null)[] = []
  let paramIdx = 1

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`)
    values.push(updates.name)
  }
  if (updates.cwd !== undefined) {
    setClauses.push(`cwd = $${paramIdx++}`)
    values.push(updates.cwd)
  }
  if (updates.pid !== undefined) {
    setClauses.push(`pid = $${paramIdx++}`)
    values.push(updates.pid)
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`)
    values.push(updates.status)
  }
  if (updates.git_branch !== undefined) {
    setClauses.push(`git_branch = $${paramIdx++}`)
    values.push(updates.git_branch)
  }
  if (updates.git_repo !== undefined) {
    setClauses.push(`git_repo = $${paramIdx++}`)
    values.push(updates.git_repo ? JSON.stringify(updates.git_repo) : null)
  }
  if (updates.setup !== undefined) {
    setClauses.push(`setup = $${paramIdx++}`)
    values.push(updates.setup ? JSON.stringify(updates.setup) : null)
  }
  if (updates.settings !== undefined) {
    setClauses.push(`settings = $${paramIdx++}`)
    values.push(updates.settings ? JSON.stringify(updates.settings) : null)
  }

  if (setClauses.length === 0) {
    return getTerminalById(id)
  }

  setClauses.push('updated_at = NOW()')
  values.push(id)

  await pool.query(
    `UPDATE terminals SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    values,
  )

  // Handle name change: update file and rename zellij session
  if (updates.name !== undefined) {
    const newName = updates.name
    // Write new name to file (fire-and-forget async)
    ;(async () => {
      try {
        await fs.promises.mkdir(WORKIO_TERMINALS_DIR, { recursive: true })
        await fs.promises.writeFile(
          path.join(WORKIO_TERMINALS_DIR, String(id)),
          newName,
        )
      } catch (err) {
        log.error({ err }, `[db] Failed to write terminal name file for ${id}`)
      }
    })()
    // Rename zellij session if it exists
    if (oldName && oldName !== newName) {
      execFile(
        'zellij',
        ['--session', oldName, 'action', 'rename-session', newName],
        { timeout: 5000 },
        (err) => {
          if (!err) {
            log.info(`[db] Renamed zellij session ${oldName} to ${newName}`)
          }
          // Session might not exist or not be running, that's ok - silently ignore errors
        },
      )
    }
  }

  return getTerminalById(id)
}

export async function deleteTerminal(id: number): Promise<boolean> {
  // shells are deleted via ON DELETE CASCADE
  const result = await pool.query('DELETE FROM terminals WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

// Shell queries

export async function createShell(
  terminalId: number,
  name = 'main',
): Promise<Shell> {
  const { rows } = await pool.query(
    `INSERT INTO shells (terminal_id, name) VALUES ($1, $2) RETURNING *`,
    [terminalId, name],
  )
  return rows[0]
}

export async function getShellsForTerminal(
  terminalId: number,
): Promise<Shell[]> {
  const { rows } = await pool.query(
    'SELECT * FROM shells WHERE terminal_id = $1 ORDER BY id',
    [terminalId],
  )
  return rows
}

export async function getShellById(id: number): Promise<Shell | undefined> {
  const { rows } = await pool.query('SELECT * FROM shells WHERE id = $1', [id])
  return rows[0]
}

export async function getMainShellForTerminal(
  terminalId: number,
): Promise<Shell | undefined> {
  const { rows } = await pool.query(
    'SELECT * FROM shells WHERE terminal_id = $1 ORDER BY id LIMIT 1',
    [terminalId],
  )
  return rows[0]
}

export async function deleteShell(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM shells WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

export async function updateShellName(
  id: number,
  name: string,
): Promise<Shell> {
  const { rows } = await pool.query(
    'UPDATE shells SET name = $1 WHERE id = $2 RETURNING *',
    [name, id],
  )
  return rows[0]
}

export async function updateShell(
  id: number,
  updates: { active_cmd?: string | null },
): Promise<void> {
  try {
    const setClauses: string[] = []
    const values: (string | null)[] = []
    let paramIdx = 1

    if (updates.active_cmd !== undefined) {
      setClauses.push(`active_cmd = $${paramIdx++}`)
      values.push(updates.active_cmd)
    }

    if (setClauses.length === 0) return

    values.push(String(id))
    await pool.query(
      `UPDATE shells SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      values,
    )
  } catch (err) {
    log.error({ err, shellId: id }, '[db] Failed to update shell')
  }
}

// Settings queries

const DEFAULT_CONFIG = {
  default_shell: '/bin/bash',
  font_size: null as number | null,
  mobile_font_size: null as number | null,
  show_thinking: false,
  show_tools: true,
  show_tool_output: false,
  message_line_clamp: 5,
  preferred_ide: 'cursor' as const,
  keymap: DEFAULT_KEYMAP,
}

export async function getSettings(): Promise<Settings> {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1')

  if (rows.length === 0) {
    await pool.query('INSERT INTO settings (id, config) VALUES (1, $1)', [
      JSON.stringify(DEFAULT_CONFIG),
    ])
    return { id: 1, ...DEFAULT_CONFIG }
  }

  const config = rows[0].config as Partial<typeof DEFAULT_CONFIG>
  return {
    id: rows[0].id,
    ...DEFAULT_CONFIG,
    ...config,
  }
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id'>>,
): Promise<Settings> {
  const current = await getSettings()
  const { id: _, ...currentConfig } = current
  const newConfig = { ...currentConfig, ...updates }

  await pool.query('UPDATE settings SET config = $1 WHERE id = 1', [
    JSON.stringify(newConfig),
  ])

  return getSettings()
}

// VAPID key management

export async function getOrCreateVapidKeys(): Promise<{
  publicKey: string
  privateKey: string
}> {
  const settings = await getSettings()
  if (settings.vapid_public_key && settings.vapid_private_key) {
    return {
      publicKey: settings.vapid_public_key,
      privateKey: settings.vapid_private_key,
    }
  }
  const webPush = await import('web-push')
  const keys = webPush.default.generateVAPIDKeys()
  await updateSettings({
    vapid_public_key: keys.publicKey,
    vapid_private_key: keys.privateKey,
  })
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}

// Notification queries

export interface Notification {
  id: number
  dedup_hash: string | null
  type: string
  repo: string | null
  read: boolean
  created_at: string
  data: Record<string, unknown>
}

export async function insertNotification(
  type: string,
  repo: string | null | undefined,
  data: Record<string, unknown>,
  dedupExtra?: string,
  prNumber?: number,
): Promise<Notification | null> {
  // Create dedup hash from type + repo + optional prNumber + optional extra
  const crypto = await import('node:crypto')
  const repoStr = repo ?? ''
  const dedupSource = prNumber
    ? `${type}:${repoStr}:${prNumber}${dedupExtra ? `:${dedupExtra}` : ''}`
    : `${type}:${repoStr}${dedupExtra ? `:${dedupExtra}` : ''}`
  const dedupHash = crypto
    .createHash('sha256')
    .update(dedupSource)
    .digest('hex')
    .substring(0, 64)

  const { rows } = await pool.query(
    `
    INSERT INTO notifications (dedup_hash, type, repo, data)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (dedup_hash) DO NOTHING
    RETURNING *
    `,
    [dedupHash, type, repo ?? null, JSON.stringify(data)],
  )
  return rows[0] || null
}

export async function getNotifications(
  limit: number,
  offset: number,
  unreadOnly = false,
): Promise<{ notifications: Notification[]; total: number }> {
  const whereClause = unreadOnly ? 'WHERE read = FALSE' : ''

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM notifications ${whereClause}`,
  )
  const total = Number.parseInt(countResult.rows[0].count, 10)

  const { rows } = await pool.query(
    `
    SELECT * FROM notifications
    ${whereClause}
    ORDER BY read ASC, created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  )

  return { notifications: rows, total }
}

export async function markAllNotificationsRead(): Promise<number> {
  const result = await pool.query(
    'UPDATE notifications SET read = TRUE WHERE read = FALSE',
  )
  return result.rowCount ?? 0
}

export async function markNotificationRead(id: number): Promise<boolean> {
  const result = await pool.query(
    'UPDATE notifications SET read = TRUE WHERE id = $1 AND read = FALSE',
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function markNotificationUnread(id: number): Promise<boolean> {
  const result = await pool.query(
    'UPDATE notifications SET read = FALSE WHERE id = $1 AND read = TRUE',
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function markNotificationReadByItem(
  repo: string,
  prNumber: number,
  commentId?: number,
  reviewId?: number,
): Promise<boolean> {
  const conditions = ['read = FALSE', `repo = $1`, `data->>'prNumber' = $2`]
  const params: (string | number)[] = [repo, String(prNumber)]
  if (commentId) {
    params.push(String(commentId))
    conditions.push(`data->>'commentId' = $${params.length}`)
  }
  if (reviewId) {
    params.push(String(reviewId))
    conditions.push(`data->>'reviewId' = $${params.length}`)
  }
  const result = await pool.query(
    `UPDATE notifications SET read = TRUE WHERE ${conditions.join(' AND ')}`,
    params,
  )
  return (result.rowCount ?? 0) > 0
}

export async function markPRNotificationsRead(
  repo: string,
  prNumber: number,
): Promise<number> {
  const result = await pool.query(
    `UPDATE notifications SET read = TRUE WHERE read = FALSE AND repo = $1 AND data->>'prNumber' = $2`,
    [repo, String(prNumber)],
  )
  return result.rowCount ?? 0
}

export async function deleteNotification(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM notifications WHERE id = $1', [
    id,
  ])
  return (result.rowCount ?? 0) > 0
}

export async function deleteAllNotifications(): Promise<number> {
  const result = await pool.query('DELETE FROM notifications')
  return result.rowCount ?? 0
}

export async function getUnreadPRNotifications(): Promise<
  UnreadPRNotification[]
> {
  const { rows } = await pool.query(`
    SELECT repo, data->>'prNumber' as pr_number, type,
           data->>'commentId' as comment_id, data->>'reviewId' as review_id
    FROM notifications
    WHERE read = FALSE AND data->>'prNumber' IS NOT NULL
  `)

  const grouped = new Map<
    string,
    {
      repo: string
      prNumber: number
      items: { commentId?: number; reviewId?: number }[]
    }
  >()

  for (const row of rows) {
    const prNumber = Number(row.pr_number)
    const key = `${row.repo}#${prNumber}`
    if (!grouped.has(key)) {
      grouped.set(key, { repo: row.repo, prNumber, items: [] })
    }
    const entry = grouped.get(key)!
    entry.items.push({
      ...(row.comment_id && { commentId: Number(row.comment_id) }),
      ...(row.review_id && { reviewId: Number(row.review_id) }),
    })
  }

  return Array.from(grouped.values()).map((g) => ({
    ...g,
    count: g.items.length,
  }))
}

// Command logging

interface LogCommandOptions {
  terminalId?: number
  prId?: string // "owner/repo#123" format
  category: 'git' | 'workspace' | 'github'
  command: string
  stdout?: string
  stderr?: string
  failed?: boolean
}

/** Fire-and-forget command logging - does not await at call sites */
export function logCommand(opts: LogCommandOptions): void {
  const exitCode = opts.failed ? 1 : 0
  ;(async () => {
    let sshHost: string | undefined
    let terminalName: string | undefined
    if (opts.terminalId) {
      const terminal = await getTerminalById(opts.terminalId)
      if (terminal) {
        sshHost = terminal.ssh_host ?? undefined
        terminalName = terminal.name ?? undefined
      }
    }
    // If not failed, combine stderr into stdout (git often outputs progress to stderr)
    let stdout = opts.stdout ?? ''
    let stderr: string | undefined
    if (opts.failed) {
      stderr = opts.stderr
    } else if (opts.stderr) {
      stdout = stdout ? `${stdout}\n${opts.stderr}` : opts.stderr
    }

    await pool.query(
      `INSERT INTO command_logs (terminal_id, pr_id, exit_code, category, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        opts.terminalId ?? null,
        opts.prId ?? null,
        exitCode,
        opts.category,
        JSON.stringify({
          command: opts.command,
          stdout: stdout.substring(0, 10000) || undefined,
          stderr: stderr?.substring(0, 5000),
          sshHost,
          terminalName,
        }),
      ],
    )
  })().catch((err) => {
    log.error(
      { err, terminalId: opts.terminalId, prId: opts.prId },
      '[command_logs] Failed to log',
    )
  })
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
