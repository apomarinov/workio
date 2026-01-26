import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import type { Project, Session, Settings, Terminal } from '../src/types'
import { env } from './env'

export type { Terminal, Project, Session, Settings }

export interface SessionWithProject extends Session {
  project_path: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.join(__dirname, '../../schema.sql')

const db = new Database(env.DB_PATH)

// Enable WAL mode and busy timeout (matching Python config)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

// Initialize database from schema.sql
if (fs.existsSync(SCHEMA_PATH)) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  db.exec(schema)
  console.log('[db] Database initialized from schema.sql')
} else {
  console.error('[db] Schema file not found:', SCHEMA_PATH)
  process.exit(1)
}

// Project queries

export function getProjectByPath(cwd: string): Project | undefined {
  return db.prepare('SELECT * FROM projects WHERE path = ?').get(cwd) as
    | Project
    | undefined
}

export function getProjectById(id: number): Project | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | Project
    | undefined
}

// Session queries

export function getAllSessions(): SessionWithProject[] {
  return db
    .prepare(`
      SELECT s.*, p.path as project_path
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      ORDER BY s.updated_at DESC
    `)
    .all() as SessionWithProject[]
}

export function deleteSession(sessionId: string): boolean {
  // Delete in order: messages (via prompts), prompts, hooks, then session
  const promptIds = db
    .prepare('SELECT id FROM prompts WHERE session_id = ?')
    .all(sessionId) as { id: number }[]

  if (promptIds.length > 0) {
    const ids = promptIds.map((p) => p.id)
    db.prepare(
      `DELETE FROM messages WHERE prompt_id IN (${ids.map(() => '?').join(',')})`,
    ).run(...ids)
  }

  db.prepare('DELETE FROM prompts WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM hooks WHERE session_id = ?').run(sessionId)
  const result = db
    .prepare('DELETE FROM sessions WHERE session_id = ?')
    .run(sessionId)
  return result.changes > 0
}

// Terminal queries

export function getAllTerminals(): Terminal[] {
  return db
    .prepare(`
    SELECT * FROM terminals
    ORDER BY created_at DESC
  `)
    .all() as Terminal[]
}

export function getTerminalById(id: number): Terminal | undefined {
  return db
    .prepare(`
    SELECT * FROM terminals WHERE id = ?
  `)
    .get(id) as Terminal | undefined
}

export function createTerminal(
  cwd: string,
  name: string | null,
  shell: string | null = null,
): Terminal {
  const result = db
    .prepare(`
    INSERT INTO terminals (cwd, name, shell)
    VALUES (?, ?, ?)
  `)
    .run(cwd, name, shell)
  return getTerminalById(result.lastInsertRowid as number)!
}

export function updateTerminal(
  id: number,
  updates: {
    name?: string
    pid?: number | null
    status?: string
    active_cmd?: string | null
  },
): Terminal | undefined {
  const setClauses: string[] = []
  const values: (string | number | null)[] = []

  if (updates.name !== undefined) {
    setClauses.push('name = ?')
    values.push(updates.name)
  }
  if (updates.pid !== undefined) {
    setClauses.push('pid = ?')
    values.push(updates.pid)
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?')
    values.push(updates.status)
  }
  if (updates.active_cmd !== undefined) {
    setClauses.push('active_cmd = ?')
    values.push(updates.active_cmd)
  }

  if (setClauses.length === 0) {
    return getTerminalById(id)
  }

  setClauses.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)

  db.prepare(`UPDATE terminals SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...values,
  )
  return getTerminalById(id)
}

export function deleteTerminal(id: number): boolean {
  const result = db.prepare('DELETE FROM terminals WHERE id = ?').run(id)
  return result.changes > 0
}

// Settings queries

export function getSettings(): Settings {
  let settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as
    | Settings
    | undefined
  if (!settings) {
    db.prepare(
      "INSERT INTO settings (id, default_shell) VALUES (1, '/bin/bash')",
    ).run()
    settings = db
      .prepare('SELECT * FROM settings WHERE id = 1')
      .get() as Settings
  }
  return settings
}

export function updateSettings(updates: {
  default_shell?: string
  font_size?: number | null
}): Settings {
  const setClauses: string[] = []
  const values: (string | number | null)[] = []

  if (updates.default_shell !== undefined) {
    setClauses.push('default_shell = ?')
    values.push(updates.default_shell)
  }
  if (updates.font_size !== undefined) {
    setClauses.push('font_size = ?')
    values.push(updates.font_size)
  }

  if (setClauses.length > 0) {
    db.prepare(`UPDATE settings SET ${setClauses.join(', ')} WHERE id = 1`).run(
      ...values,
    )
  }
  return getSettings()
}

export default db
