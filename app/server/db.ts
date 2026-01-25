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

// Initialize terminal_sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS terminal_sessions (
    id TEXT PRIMARY KEY,
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

export default db
