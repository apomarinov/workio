-- Claude Dashboard Database Schema (PostgreSQL)
-- This file is run on startup to ensure the database schema is complete.
-- All statements use IF NOT EXISTS / OR REPLACE for idempotent runs.

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    path TEXT UNIQUE
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(100) PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    terminal_id INTEGER,
    name VARCHAR(200),
    message_count INTEGER,
    status VARCHAR(20),
    transcript_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompts table
CREATE TABLE IF NOT EXISTS prompts (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) REFERENCES sessions(session_id) ON DELETE CASCADE,
    prompt TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    prompt_id INTEGER REFERENCES prompts(id) ON DELETE CASCADE,
    uuid VARCHAR(100) UNIQUE,
    is_user BOOLEAN DEFAULT FALSE,
    thinking BOOLEAN DEFAULT FALSE,
    todo_id VARCHAR(100),
    body TEXT,
    tools JSONB,
    images JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hooks table
CREATE TABLE IF NOT EXISTS hooks (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100),
    hook_type VARCHAR(30),
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleans table
CREATE TABLE IF NOT EXISTS cleans (
    id SERIAL PRIMARY KEY,
    type VARCHAR(10) DEFAULT 'data',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Terminals table
CREATE TABLE IF NOT EXISTS terminals (
    id SERIAL PRIMARY KEY,
    cwd TEXT NOT NULL,
    name VARCHAR(255),
    shell VARCHAR(255),
    ssh_host VARCHAR(255),
    pid INTEGER,
    status VARCHAR(10) DEFAULT 'running',
    active_cmd TEXT,
    git_branch VARCHAR(255),
    git_repo JSONB,
    setup JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table (singleton with JSONB config)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cleans_type ON cleans(type);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_hooks_session_id ON hooks(session_id);
CREATE INDEX IF NOT EXISTS idx_hooks_created_at ON hooks(created_at);
CREATE INDEX IF NOT EXISTS idx_prompts_session_id ON prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_prompt_id ON messages(prompt_id);
CREATE INDEX IF NOT EXISTS idx_messages_todo_id ON messages(todo_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

-- Trigger function: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at (use DO block for IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sessions_updated_at') THEN
        CREATE TRIGGER sessions_updated_at
            BEFORE UPDATE ON sessions
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_updated_at') THEN
        CREATE TRIGGER messages_updated_at
            BEFORE UPDATE ON messages
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END;
$$;

-- Insert default settings row if not present
INSERT INTO settings (id, config) VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;
