#!/usr/bin/env python3
"""
Database utilities for the Claude Code Monitor (PostgreSQL).
"""

import json
import os
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

for env_file in [".env", ".env.local"]:
    load_dotenv(Path(__file__).parent / env_file, override=True)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/workio")
SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def get_db():
    """Get a database connection."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def get_cursor(conn):
    """Get a cursor that returns dicts."""
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def init_db():
    """Initialize the database by running schema.sql and return a connection."""
    conn = get_db()

    if SCHEMA_PATH.exists():
        schema_sql = SCHEMA_PATH.read_text()
        cur = conn.cursor()
        cur.execute(schema_sql)
        conn.commit()
    else:
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_PATH}")

    return conn


# Notifications

def notify(conn, channel: str, payload: dict) -> None:
    """Send a PostgreSQL NOTIFY with JSON payload.
    Must be called before conn.commit() — NOTIFY is delivered on commit."""
    cur = conn.cursor()
    cur.execute("SELECT pg_notify(%s, %s)", (channel, json.dumps(payload)))


# Logs

def log(conn, message: str, **kwargs) -> None:
    """Log a message with additional data to the logs table."""
    data = {"message": message, **kwargs}
    cur = conn.cursor()
    cur.execute('INSERT INTO logs (data) VALUES (%s)', (json.dumps(data),))


# Hooks

def save_hook(conn, session_id: str, hook_type: str, payload: dict) -> None:
    """Save a hook event with its full payload."""
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO hooks (session_id, hook_type, payload) VALUES (%s, %s, %s)',
        (session_id, hook_type, json.dumps(payload))
    )


# Projects

def upsert_project(conn, path: str) -> int:
    """Upsert project by path, returning project ID."""
    cur = get_cursor(conn)
    cur.execute('SELECT id FROM projects WHERE path = %s', (path,))
    row = cur.fetchone()
    if row:
        return row['id']
    cur.execute('INSERT INTO projects (path) VALUES (%s) RETURNING id', (path,))
    return cur.fetchone()['id']


def update_project_path_by_session(conn, session_id: str, path: str) -> bool:
    """Update the project path for an existing session. Returns True if updated."""
    cur = get_cursor(conn)
    cur.execute(
        'SELECT project_id FROM sessions WHERE session_id = %s',
        (session_id,)
    )
    row = cur.fetchone()
    if row:
        existing = cur.execute(
            'SELECT id FROM projects WHERE path = %s AND id != %s',
            (path, row['project_id'])
        )
        existing_row = cur.fetchone()
        if existing_row:
            return False
        cur.execute('UPDATE projects SET path = %s WHERE id = %s', (path, row['project_id']))
        return True
    return False


# Sessions

def upsert_session(conn, session_id: str, project_id: int, status: str, transcript_path: str, terminal_id: int | None = None, shell_id: int | None = None) -> None:
    """Insert or update a session. Note: project_id is only set on insert, not updated."""
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO sessions (session_id, project_id, terminal_id, shell_id, status, transcript_path)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT(session_id) DO UPDATE SET
            terminal_id = COALESCE(EXCLUDED.terminal_id, sessions.terminal_id),
            shell_id = COALESCE(EXCLUDED.shell_id, sessions.shell_id),
            status = EXCLUDED.status,
            transcript_path = EXCLUDED.transcript_path
    ''', (session_id, project_id, terminal_id, shell_id, status, transcript_path))


def update_session_metadata(conn, session_id: str, name: str | None, message_count: int | None) -> None:
    """Update session metadata. Preserves existing name/message_count when new values are NULL."""
    cur = conn.cursor()
    cur.execute('''
        UPDATE sessions SET
            name = COALESCE(%s, sessions.name),
            message_count = COALESCE(%s, sessions.message_count)
        WHERE session_id = %s
    ''', (name[:200] if name else None, message_count, session_id))


def update_session_name_if_empty(conn, session_id: str, name: str) -> None:
    """Update session name only if the current name is empty."""
    cur = conn.cursor()
    cur.execute('''
        UPDATE sessions SET name = %s
        WHERE session_id = %s AND (name IS NULL OR name = '')
    ''', (name[:200], session_id))


def get_session(conn, session_id: str):
    """Get a session by ID."""
    cur = get_cursor(conn)
    cur.execute(
        'SELECT * FROM sessions WHERE session_id = %s',
        (session_id,)
    )
    return cur.fetchone()


def get_session_project_path(conn, session_id: str) -> str | None:
    """Get the stored project path for a session."""
    cur = get_cursor(conn)
    cur.execute('''
        SELECT p.path FROM sessions s
        JOIN projects p ON s.project_id = p.id
        WHERE s.session_id = %s
    ''', (session_id,))
    row = cur.fetchone()
    return row['path'] if row else None


def get_stale_session_ids(conn, project_id: int, current_session_id: str) -> list[str]:
    """Get session IDs that are stale (started but not current)."""
    cur = get_cursor(conn)
    cur.execute('''
        SELECT session_id FROM sessions
        WHERE project_id = %s
          AND session_id != %s
          AND status = 'started'
    ''', (project_id, current_session_id))
    rows = cur.fetchall()
    return [row['session_id'] for row in rows]


def delete_sessions_cascade(conn, session_ids: list[str]) -> None:
    """Delete sessions and all related data (messages, prompts, hooks)."""
    if not session_ids:
        return

    cur = conn.cursor()

    # Delete messages for these sessions' prompts
    cur.execute('''
        DELETE FROM messages WHERE prompt_id IN (
            SELECT id FROM prompts WHERE session_id = ANY(%s)
        )
    ''', (session_ids,))

    # Delete prompts
    cur.execute('DELETE FROM prompts WHERE session_id = ANY(%s)', (session_ids,))

    # Delete hooks
    cur.execute('DELETE FROM hooks WHERE session_id = ANY(%s)', (session_ids,))

    # Delete sessions
    cur.execute('DELETE FROM sessions WHERE session_id = ANY(%s)', (session_ids,))


# Prompts

def create_prompt(conn, session_id: str, prompt_text: str | None = None) -> int:
    """Create a new prompt for a session."""
    cur = get_cursor(conn)
    cur.execute('''
        INSERT INTO prompts (session_id, prompt)
        VALUES (%s, %s)
        RETURNING id
    ''', (session_id, prompt_text))
    return cur.fetchone()['id']


def get_latest_prompt(conn, session_id: str):
    """Get the latest prompt for a session."""
    cur = get_cursor(conn)
    cur.execute(
        'SELECT id, prompt FROM prompts WHERE session_id = %s ORDER BY id DESC LIMIT 1',
        (session_id,)
    )
    return cur.fetchone()


def update_prompt_text(conn, prompt_id: int, prompt_text: str) -> None:
    """Update the prompt text for a prompt."""
    cur = conn.cursor()
    cur.execute('UPDATE prompts SET prompt = %s WHERE id = %s', (prompt_text, prompt_id))


# Messages

def message_exists(conn, uuid: str) -> bool:
    """Check if a message with the given UUID exists."""
    cur = conn.cursor()
    cur.execute('SELECT id FROM messages WHERE uuid = %s', (uuid,))
    return cur.fetchone() is not None


def create_message(
    conn,
    prompt_id: int,
    uuid: str,
    created_at: str,
    body: str | None,
    is_thinking: bool,
    is_user: bool,
    tools: str | None = None,
    todo_id: str | None = None,
    images: str | None = None
) -> int:
    """Create a new message."""
    cur = get_cursor(conn)
    cur.execute('''
        INSERT INTO messages (prompt_id, uuid, created_at, body, thinking, is_user, tools, todo_id, images)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    ''', (prompt_id, uuid, created_at, body, is_thinking, is_user, tools, todo_id, images))
    return cur.fetchone()['id']


def compute_todo_hash(session_id: str, todos: list[dict]) -> str:
    """Compute MD5 hash from session_id + sorted todo contents.

    This creates a stable identifier for a specific set of todos,
    regardless of their status, prompt_id, or tool_use_id.
    """
    import hashlib

    # Sort todo contents to ensure consistent ordering
    contents = sorted(t.get('content', '') for t in todos)
    hash_input = f"{session_id}:" + "|".join(contents)
    return hashlib.md5(hash_input.encode()).hexdigest()


def compute_state_key(todos: list[dict]) -> str:
    """Compute MD5 hash from all todo statuses in order.

    This creates a key that changes whenever any todo status changes,
    enabling socket updates for todo progress.
    """
    import hashlib

    # Preserve order - statuses in the same order as todos
    statuses = [t.get('status', 'pending') for t in todos]
    hash_input = "|".join(statuses)
    return hashlib.md5(hash_input.encode()).hexdigest()


def upsert_todo_message(
    conn,
    session_id: str,
    prompt_id: int,
    uuid: str,
    created_at: str,
    tools: str,
    todos: list[dict],
    state_key: str
) -> tuple[int, str, bool, bool]:
    """Upsert a todo message. Returns (message_id, todo_id, is_new, state_changed).

    Uses MD5 hash of session_id + todo contents as the stable identifier.
    This ensures the same todo list always maps to the same message,
    regardless of prompt_id, tool_use_id, or reprocessing.

    state_key is used to detect when todo statuses have changed.
    """
    # Compute stable hash from session_id + todo contents
    todo_hash = compute_todo_hash(session_id, todos)

    # Check if a message with this todo_hash already exists
    cur = get_cursor(conn)
    cur.execute('''
        SELECT id, todo_id, tools FROM messages WHERE todo_id = %s
    ''', (todo_hash,))
    existing = cur.fetchone()

    if existing:
        # Check if state_key changed by comparing with stored tools JSON
        state_changed = False
        try:
            old_tools = existing['tools'] if existing['tools'] else {}
            if isinstance(old_tools, str):
                old_tools = json.loads(old_tools)
            old_state_key = old_tools.get('state_key', '')
            if old_state_key and old_state_key != state_key:
                state_changed = True
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

        if state_changed:
            cur.execute('''
                UPDATE messages SET tools = %s, updated_at = NOW()
                WHERE id = %s
            ''', (tools, existing['id']))
        return existing['id'], existing['todo_id'], False, state_changed

    # Create new todo message with hash as todo_id
    cur.execute('''
        INSERT INTO messages (prompt_id, uuid, created_at, body, thinking, is_user, tools, todo_id)
        VALUES (%s, %s, %s, NULL, FALSE, FALSE, %s, %s)
        RETURNING id
    ''', (prompt_id, uuid, created_at, tools, todo_hash))
    new_id = cur.fetchone()['id']
    return new_id, todo_hash, True, False


def get_latest_user_message(conn, prompt_id: int):
    """Get the latest user message for a prompt."""
    cur = get_cursor(conn)
    cur.execute('''
        SELECT body FROM messages
        WHERE prompt_id = %s AND is_user = TRUE
        ORDER BY id DESC LIMIT 1
    ''', (prompt_id,))
    return cur.fetchone()
