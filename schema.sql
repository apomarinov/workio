-- Claude Dashboard Database Schema
-- This file is run by both Python (monitor) and Node.js (app server)
-- to ensure the database schema is complete.

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_id INTEGER,
    terminal_id INTEGER,
    name TEXT,
    git_branch TEXT,
    message_count INTEGER,
    status TEXT,
    transcript_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Sessions updated_at trigger
CREATE TRIGGER IF NOT EXISTS sessions_updated_at
AFTER UPDATE ON sessions
FOR EACH ROW
BEGIN
    UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = OLD.session_id;
END;

-- Prompts table
CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    prompt TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    prompt_id INTEGER,
    uuid TEXT UNIQUE,
    is_user BOOLEAN DEFAULT 0,
    thinking BOOLEAN DEFAULT 0,
    todo_id TEXT,
    body TEXT,
    tools JSON,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Messages updated_at trigger
CREATE TRIGGER IF NOT EXISTS messages_updated_at
AFTER UPDATE ON messages
FOR EACH ROW
BEGIN
    UPDATE messages SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    data JSON,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Hooks table
CREATE TABLE IF NOT EXISTS hooks (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    hook_type TEXT,
    payload JSON,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Cleans table
CREATE TABLE IF NOT EXISTS cleans (
    id INTEGER PRIMARY KEY,
    type TEXT DEFAULT 'data',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Terminals table
CREATE TABLE IF NOT EXISTS terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cwd TEXT NOT NULL,
    name TEXT,
    shell TEXT,
    pid INTEGER,
    status TEXT DEFAULT 'running',
    active_cmd TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Settings table (singleton with JSON config)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config JSON NOT NULL DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cleans_type ON cleans(type);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_hooks_type ON hooks(hook_type);
CREATE INDEX IF NOT EXISTS idx_terminals_status ON terminals(status);
