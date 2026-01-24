#!/usr/bin/env python3
"""
Claude Code Hook Monitor

Receives events from Claude Code hooks and stores them for the dashboard.
"""

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from notify import notify

DB_PATH = Path(__file__).parent / "data.db"


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            path TEXT UNIQUE,
            active_session_id TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY,
            session_id TEXT,
            project_id INTEGER,
            event_type TEXT,
            tool_name TEXT,
            data JSON,
            timestamp TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            project_id INTEGER,
            name TEXT,
            git_branch TEXT,
            message_count INTEGER,
            status TEXT,
            current_tool TEXT,
            last_updated TEXT
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(last_updated)')
    conn.commit()
    return conn


def get_project_id(conn: sqlite3.Connection, path: str) -> int:
    cursor = conn.execute('INSERT OR IGNORE INTO projects (path) VALUES (?)', (path,))
    if cursor.lastrowid:
        return cursor.lastrowid
    row = conn.execute('SELECT id FROM projects WHERE path = ?', (path,)).fetchone()
    return row[0]


def get_session_index_entry(project_path: str, session_id: str) -> dict | None:
    """Get session entry from Claude's sessions-index.json."""
    encoded_path = project_path.replace('/', '-')
    index_path = Path.home() / '.claude' / 'projects' / encoded_path / 'sessions-index.json'

    if not index_path.exists():
        return None

    try:
        with open(index_path) as f:
            data = json.load(f)

        for entry in data.get('entries', []):
            if entry.get('sessionId') == session_id:
                return entry
    except (json.JSONDecodeError, IOError):
        pass

    return None


def clean_sessions(conn: sqlite3.Connection, project_id: int, current_session_id: str) -> None:
    """Remove stale sessions that only have a SessionStart event."""
    # Find sessions in 'started' status for this project, excluding current session
    stale_sessions = conn.execute('''
        SELECT s.session_id FROM sessions s
        WHERE s.project_id = ?
          AND s.session_id != ?
          AND s.status = 'started'
          AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id) = 1
          AND (SELECT event_type FROM events e WHERE e.session_id = s.session_id LIMIT 1) = 'SessionStart'
    ''', (project_id, current_session_id)).fetchall()

    for (session_id,) in stale_sessions:
        conn.execute('DELETE FROM events WHERE session_id = ?', (session_id,))
        conn.execute('DELETE FROM sessions WHERE session_id = ?', (session_id,))


def update_session(conn: sqlite3.Connection, project_path: str, session_id: str) -> None:
    """Update session metadata from Claude's sessions-index.json."""
    entry = get_session_index_entry(project_path, session_id)
    if not entry:
        return

    name = entry.get('customTitle') or entry.get('firstPrompt')
    git_branch = entry.get('gitBranch')
    message_count = entry.get('messageCount')

    conn.execute('''
        UPDATE sessions SET name = ?, git_branch = ?, message_count = ? WHERE session_id = ?
    ''', (name[:200] if name else None, git_branch, message_count, session_id))


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        print(json.dumps({"continue": True}))
        return

    conn = init_db()

    session_id = event.get('session_id', 'unknown')
    project_path = event.get('cwd', '')
    hook_type = event.get('hook_event_name', '')
    tool_name = event.get('tool_name', '')

    project_id = get_project_id(conn, project_path)

    # Store event
    conn.execute('''
        INSERT INTO events (session_id, project_id, event_type, tool_name, data, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        session_id,
        project_id,
        hook_type,
        tool_name,
        json.dumps(event),
        datetime.now().isoformat()
    ))

    # Determine session status and current tool
    status = None
    current_tool = None

    if hook_type == 'SessionStart':
        status = 'started'
    elif hook_type == 'UserPromptSubmit':
        status = 'active'
    elif hook_type == 'PreToolUse':
        status = 'active'
        current_tool = tool_name
    elif hook_type == 'PostToolUse':
        status = 'active'
        current_tool = None
    elif hook_type == 'Stop':
        status = 'done'
        current_tool = None
    elif hook_type == 'SessionEnd':
        status = 'ended'
        current_tool = None
    elif hook_type == 'Notification':
        notification_type = event.get('notification_type', '')
        if notification_type == 'permission_prompt':
            status = 'permission_needed'
        elif notification_type == 'idle_prompt':
            status = 'idle'

    # Update session if we have a status
    if status:
        conn.execute('''
            INSERT INTO sessions (session_id, project_id, status, current_tool, last_updated)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                project_id = excluded.project_id,
                status = excluded.status,
                current_tool = COALESCE(excluded.current_tool, sessions.current_tool),
                last_updated = excluded.last_updated
        ''', (
            session_id,
            project_id,
            status,
            current_tool,
            datetime.now().isoformat()
        ))

    # Update project's active session
    if hook_type == 'SessionStart':
        conn.execute('UPDATE projects SET active_session_id = ? WHERE id = ?', (session_id, project_id))
        clean_sessions(conn, project_id, session_id)
    elif hook_type == 'SessionEnd':
        conn.execute('UPDATE projects SET active_session_id = NULL WHERE id = ?', (project_id,))

    # Update session metadata
    if hook_type in ('SessionStart', 'UserPromptSubmit'):
        update_session(conn, project_path, session_id)

    conn.commit()
    conn.close()

    # Send notification if permission is needed
    if status == 'permission_needed':
        project_name = Path(project_path).name if project_path else 'Unknown'
        notify(project_name, "Permission Request")

    print(json.dumps({"continue": True}))


if __name__ == "__main__":
    main()
