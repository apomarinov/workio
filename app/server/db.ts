import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Use the existing data.db from parent directory
const DB_PATH = path.join(__dirname, '../../data.db')

const db = new Database(DB_PATH)

// Enable WAL mode and busy timeout (matching Python config)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

// Drop old table if it has TEXT id (migration)
const tableInfo = db.prepare("PRAGMA table_info(terminal_sessions)").all() as { name: string; type: string }[]
const idCol = tableInfo.find(c => c.name === 'id')
if (idCol && idCol.type === 'TEXT') {
  db.exec('DROP TABLE terminal_sessions')
}

// Initialize terminal_sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS terminal_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER UNIQUE,
    name TEXT,
    pid INTEGER,
    status TEXT DEFAULT 'running',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_terminal_sessions_status
  ON terminal_sessions(status)
`)

// Types
export interface TerminalSession {
  id: number
  project_id: number
  name: string | null
  pid: number | null
  status: 'running' | 'stopped'
  created_at: string
  updated_at: string
  path?: string // joined from projects
}

export interface Project {
  id: number
  path: string
  active_session_id: string | null
}

// Project queries

export function getProjectByPath(cwd: string): Project | undefined {
  return db.prepare('SELECT * FROM projects WHERE path = ?').get(cwd) as Project | undefined
}

export function getProjectById(id: number): Project | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined
}

// Terminal session queries

export function getSessionByProjectId(projectId: number): TerminalSession | undefined {
  return db.prepare(`
    SELECT ts.*, p.path
    FROM terminal_sessions ts
    JOIN projects p ON ts.project_id = p.id
    WHERE ts.project_id = ?
  `).get(projectId) as TerminalSession | undefined
}

export function getAllSessions(): TerminalSession[] {
  return db.prepare(`
    SELECT ts.*, p.path
    FROM terminal_sessions ts
    JOIN projects p ON ts.project_id = p.id
    ORDER BY ts.created_at DESC
  `).all() as TerminalSession[]
}

export function getSessionById(id: number): TerminalSession | undefined {
  return db.prepare(`
    SELECT ts.*, p.path
    FROM terminal_sessions ts
    JOIN projects p ON ts.project_id = p.id
    WHERE ts.id = ?
  `).get(id) as TerminalSession | undefined
}

export function createSession(projectId: number, name: string | null): TerminalSession {
  const result = db.prepare(`
    INSERT INTO terminal_sessions (project_id, name)
    VALUES (?, ?)
  `).run(projectId, name)
  return getSessionById(result.lastInsertRowid as number)!
}

export function updateSession(id: number, updates: { name?: string; pid?: number | null; status?: string }): TerminalSession | undefined {
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
    return getSessionById(id)
  }

  setClauses.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)

  db.prepare(`UPDATE terminal_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  return getSessionById(id)
}

export function deleteSession(id: number): boolean {
  const result = db.prepare('DELETE FROM terminal_sessions WHERE id = ?').run(id)
  return result.changes > 0
}

export default db
