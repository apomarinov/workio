#!/usr/bin/env python3
"""
Database utilities for the Claude Code Monitor.
"""

import json
import sqlite3
from pathlib import Path
from dotenv import load_dotenv
import os

for env_file in [".env", ".env.local"]:
    load_dotenv(Path(__file__).parent / env_file, override=True)

DB_PATH = Path(__file__).parent / os.environ.get("DB_NAME", "data.db")


def get_db() -> sqlite3.Connection:
    """Get a database connection with WAL mode and busy timeout."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> sqlite3.Connection:
    """Initialize the database and return a connection."""
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            path TEXT UNIQUE
        )
    ''')
    conn.execute('''
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
        )
    ''')
    conn.execute('''
        CREATE TRIGGER IF NOT EXISTS sessions_updated_at
        AFTER UPDATE ON sessions
        FOR EACH ROW
        BEGIN
            UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = OLD.session_id;
        END
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY,
            session_id TEXT,
            prompt TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY,
            prompt_id INTEGER,
            uuid TEXT UNIQUE,
            is_user BOOLEAN DEFAULT 0,
            thinking BOOLEAN DEFAULT 0,
            body TEXT,
            created_at TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY,
            data JSON,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS hooks (
            id INTEGER PRIMARY KEY,
            session_id TEXT,
            hook_type TEXT,
            payload JSON,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cleans (
            id INTEGER PRIMARY KEY,
            type TEXT DEFAULT 'data',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_cleans_type ON cleans(type)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_hooks_type ON hooks(hook_type)')
    conn.commit()
    return conn


# Logs

def log(conn: sqlite3.Connection, message: str, **kwargs) -> None:
    """Log a message with additional data to the logs table."""
    data = {"message": message, **kwargs}
    conn.execute('INSERT INTO logs (data) VALUES (?)', (json.dumps(data),))


# Hooks

def save_hook(conn: sqlite3.Connection, session_id: str, hook_type: str, payload: dict) -> None:
    """Save a hook event with its full payload."""
    conn.execute(
        'INSERT INTO hooks (session_id, hook_type, payload) VALUES (?, ?, ?)',
        (session_id, hook_type, json.dumps(payload))
    )


# Projects

def upsert_project(conn: sqlite3.Connection, path: str) -> int:
    """Upsert project by path, returning project ID."""
    row = conn.execute('SELECT id FROM projects WHERE path = ?', (path,)).fetchone()
    if row:
        return row['id']
    cursor = conn.execute('INSERT INTO projects (path) VALUES (?)', (path,))
    return cursor.lastrowid


def update_project_path_by_session(conn: sqlite3.Connection, session_id: str, path: str) -> bool:
    """Update the project path for an existing session. Returns True if updated."""
    row = conn.execute(
        'SELECT project_id FROM sessions WHERE session_id = ?',
        (session_id,)
    ).fetchone()
    if row:
        # Check if path already exists in another project
        existing = conn.execute(
            'SELECT id FROM projects WHERE path = ? AND id != ?',
            (path, row['project_id'])
        ).fetchone()
        if existing:
            return False
        conn.execute('UPDATE projects SET path = ? WHERE id = ?', (path, row['project_id']))
        return True
    return False


# Sessions

def upsert_session(conn: sqlite3.Connection, session_id: str, project_id: int, status: str, transcript_path: str, terminal_id: int | None = None) -> None:
    """Insert or update a session."""
    conn.execute('''
        INSERT INTO sessions (session_id, project_id, terminal_id, status, transcript_path)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            project_id = excluded.project_id,
            terminal_id = COALESCE(excluded.terminal_id, sessions.terminal_id),
            status = excluded.status,
            transcript_path = excluded.transcript_path
    ''', (session_id, project_id, terminal_id, status, transcript_path))


def update_session_metadata(conn: sqlite3.Connection, session_id: str, name: str | None, git_branch: str | None, message_count: int | None) -> None:
    """Update session metadata."""
    conn.execute('''
        UPDATE sessions SET name = ?, git_branch = ?, message_count = ?
        WHERE session_id = ?
    ''', (name[:200] if name else None, git_branch, message_count, session_id))


def update_session_name_if_empty(conn: sqlite3.Connection, session_id: str, name: str) -> None:
    """Update session name only if the current name is empty."""
    conn.execute('''
        UPDATE sessions SET name = ?
        WHERE session_id = ? AND (name IS NULL OR name = '')
    ''', (name[:200], session_id))


def get_session(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row | None:
    """Get a session by ID."""
    return conn.execute(
        'SELECT * FROM sessions WHERE session_id = ?',
        (session_id,)
    ).fetchone()


def get_stale_session_ids(conn: sqlite3.Connection, project_id: int, current_session_id: str) -> list[str]:
    """Get session IDs that are stale (started but not current)."""
    rows = conn.execute('''
        SELECT session_id FROM sessions
        WHERE project_id = ?
          AND session_id != ?
          AND status = 'started'
    ''', (project_id, current_session_id)).fetchall()
    return [row['session_id'] for row in rows]


def delete_sessions_cascade(conn: sqlite3.Connection, session_ids: list[str]) -> None:
    """Delete sessions and all related data (messages, prompts, hooks)."""
    if not session_ids:
        return

    placeholders = ','.join('?' * len(session_ids))

    # Delete messages for these sessions' prompts
    conn.execute(f'''
        DELETE FROM messages WHERE prompt_id IN (
            SELECT id FROM prompts WHERE session_id IN ({placeholders})
        )
    ''', session_ids)

    # Delete prompts
    conn.execute(f'DELETE FROM prompts WHERE session_id IN ({placeholders})', session_ids)

    # Delete hooks
    conn.execute(f'DELETE FROM hooks WHERE session_id IN ({placeholders})', session_ids)

    # Delete sessions
    conn.execute(f'DELETE FROM sessions WHERE session_id IN ({placeholders})', session_ids)


# Prompts

def create_prompt(conn: sqlite3.Connection, session_id: str, prompt_text: str | None = None) -> int:
    """Create a new prompt for a session."""
    cursor = conn.execute('''
        INSERT INTO prompts (session_id, prompt)
        VALUES (?, ?)
    ''', (session_id, prompt_text))
    return cursor.lastrowid


def get_latest_prompt(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row | None:
    """Get the latest prompt for a session."""
    return conn.execute(
        'SELECT id, prompt FROM prompts WHERE session_id = ? ORDER BY id DESC LIMIT 1',
        (session_id,)
    ).fetchone()


def update_prompt_text(conn: sqlite3.Connection, prompt_id: int, prompt_text: str) -> None:
    """Update the prompt text for a prompt."""
    conn.execute('UPDATE prompts SET prompt = ? WHERE id = ?', (prompt_text, prompt_id))


# Messages

def message_exists(conn: sqlite3.Connection, uuid: str) -> bool:
    """Check if a message with the given UUID exists."""
    return conn.execute('SELECT id FROM messages WHERE uuid = ?', (uuid,)).fetchone() is not None


def create_message(conn: sqlite3.Connection, prompt_id: int, uuid: str, created_at: str, body: str, is_thinking: bool, is_user: bool) -> int:
    """Create a new message."""
    cursor = conn.execute('''
        INSERT INTO messages (prompt_id, uuid, created_at, body, thinking, is_user)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (prompt_id, uuid, created_at, body, is_thinking, is_user))
    return cursor.lastrowid


def get_latest_user_message(conn: sqlite3.Connection, prompt_id: int) -> sqlite3.Row | None:
    """Get the latest user message for a prompt."""
    return conn.execute('''
        SELECT body FROM messages
        WHERE prompt_id = ? AND is_user = 1
        ORDER BY id DESC LIMIT 1
    ''', (prompt_id,)).fetchone()
