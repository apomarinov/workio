import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type {
  Project,
  SessionWithProject,
  Settings,
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
      ORDER BY COALESCE(m.updated_at, m.created_at) DESC
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

export async function deleteSessions(sessionIds: string[]): Promise<number> {
  if (sessionIds.length === 0) return 0
  let deleted = 0
  for (const sessionId of sessionIds) {
    if (await deleteSession(sessionId)) deleted++
  }
  return deleted
}

// Terminal queries

export async function getAllTerminals(): Promise<Terminal[]> {
  const { rows } = await pool.query(`
    SELECT * FROM terminals
    ORDER BY created_at DESC
  `)
  return rows
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
  return rows[0]
}

export async function createTerminal(
  cwd: string,
  name: string | null,
  shell: string | null = null,
  ssh_host: string | null = null,
  git_repo: object | null = null,
  setup: object | null = null,
): Promise<Terminal> {
  const { rows } = await pool.query(
    `
    INSERT INTO terminals (cwd, name, shell, ssh_host, git_repo, setup)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `,
    [
      cwd,
      name,
      shell,
      ssh_host,
      git_repo ? JSON.stringify(git_repo) : null,
      setup ? JSON.stringify(setup) : null,
    ],
  )
  return rows[0]
}

export async function updateTerminal(
  id: number,
  updates: {
    name?: string
    cwd?: string
    pid?: number | null
    status?: string
    active_cmd?: string | null
    git_branch?: string | null
    git_repo?: object | null
    setup?: object | null
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
  if (updates.active_cmd !== undefined) {
    setClauses.push(`active_cmd = $${paramIdx++}`)
    values.push(updates.active_cmd)
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
    // Write new name to file
    try {
      if (!fs.existsSync(WORKIO_TERMINALS_DIR)) {
        fs.mkdirSync(WORKIO_TERMINALS_DIR, { recursive: true })
      }
      fs.writeFileSync(path.join(WORKIO_TERMINALS_DIR, String(id)), newName)
    } catch (err) {
      log.error({ err }, `[db] Failed to write terminal name file for ${id}`)
    }
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
  const result = await pool.query('DELETE FROM terminals WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

// Settings queries

const DEFAULT_CONFIG = {
  default_shell: '/bin/bash',
  font_size: null as number | null,
  show_thinking: false,
  show_tools: true,
  show_tool_output: false,
  message_line_clamp: 5,
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

// Notification queries

export interface Notification {
  id: number
  dedup_hash: string | null
  type: string
  repo: string
  read: boolean
  created_at: string
  data: Record<string, unknown>
}

export async function insertNotification(
  type: string,
  repo: string,
  prNumber: number,
  data: Record<string, unknown>,
  dedupExtra?: string,
): Promise<Notification | null> {
  // Create dedup hash from type + repo + prNumber + optional extra
  const crypto = await import('node:crypto')
  const dedupSource = `${type}:${repo}:${prNumber}${dedupExtra ? `:${dedupExtra}` : ''}`
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
    [dedupHash, type, repo, JSON.stringify(data)],
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
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  )

  return { notifications: rows, total }
}

export async function markNotificationRead(id: number): Promise<boolean> {
  const result = await pool.query(
    'UPDATE notifications SET read = TRUE WHERE id = $1',
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function markAllNotificationsRead(): Promise<number> {
  const result = await pool.query(
    'UPDATE notifications SET read = TRUE WHERE read = FALSE',
  )
  return result.rowCount ?? 0
}

export default pool
