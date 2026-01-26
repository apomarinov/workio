import Database from 'better-sqlite3'
import type { Project, Settings, Terminal } from '../src/types'
import { env } from './env'

export type { Terminal, Project, Settings }

const db = new Database(env.DB_PATH)

// Enable WAL mode and busy timeout (matching Python config)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

// Initialize terminals table
db.exec(`
  CREATE TABLE IF NOT EXISTS terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cwd TEXT NOT NULL,
    name TEXT,
    shell TEXT,
    pid INTEGER,
    status TEXT DEFAULT 'running',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_terminals_status
  ON terminals(status)
`)

// Initialize settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_shell TEXT NOT NULL DEFAULT '/bin/bash',
    font_size INTEGER
  )
`)

console.log('[db] Database initialized')

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
  updates: { name?: string; pid?: number | null; status?: string },
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
