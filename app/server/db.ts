import Database from 'better-sqlite3'
import type { Project, Terminal } from '../src/types'
import { env } from './env'

export type { Terminal, Project }

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

export function createTerminal(cwd: string, name: string | null): Terminal {
  const result = db
    .prepare(`
    INSERT INTO terminals (cwd, name)
    VALUES (?, ?)
  `)
    .run(cwd, name)
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

export default db
