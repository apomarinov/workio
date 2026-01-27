#!/usr/bin/env python3
"""
Cleanup worker for removing old data from the database and stale files.
"""

import time
from pathlib import Path

from db import init_db, log

DEBOUNCE_DIR = Path(__file__).parent / "debounce"
LOCKS_DIR = Path(__file__).parent / "locks"

# Cleanup intervals
DATA_CLEANUP_INTERVAL = '-7 days'
LOCKS_CLEANUP_INTERVAL = '-1 hours'
LOCKS_FILE_MAX_AGE = 3600  # 1 hour in seconds


def has_recent_cleanup(conn, cleanup_type: str, interval: str) -> bool:
    """Check if there's a cleanup of this type within the interval."""
    result = conn.execute('''
        SELECT id FROM cleans
        WHERE type = ? AND created_at > datetime('now', ?)
        LIMIT 1
    ''', (cleanup_type, interval)).fetchone()
    return result is not None


def record_cleanup(conn, cleanup_type: str) -> None:
    """Record a cleanup of a specific type."""
    conn.execute('INSERT INTO cleans (type) VALUES (?)', (cleanup_type,))
    conn.commit()


def delete_old_logs_and_hooks(conn) -> int:
    """Delete logs and hooks older than a week. Returns count deleted."""
    cursor = conn.execute('''
        DELETE FROM logs WHERE created_at < datetime('now', '-7 days')
    ''')
    logs_deleted = cursor.rowcount

    cursor = conn.execute('''
        DELETE FROM hooks WHERE created_at < datetime('now', '-7 days')
    ''')
    hooks_deleted = cursor.rowcount

    return logs_deleted + hooks_deleted


def delete_old_session_data(conn) -> int:
    """Delete messages and prompts for sessions older than a week. Returns count deleted."""
    # Get old session IDs
    old_sessions = conn.execute('''
        SELECT session_id FROM sessions
        WHERE updated_at < datetime('now', '-7 days')
    ''').fetchall()

    if not old_sessions:
        return 0

    session_ids = [s['session_id'] for s in old_sessions]
    placeholders = ','.join('?' * len(session_ids))

    # Delete messages for old sessions' prompts
    cursor = conn.execute(f'''
        DELETE FROM messages WHERE prompt_id IN (
            SELECT id FROM prompts WHERE session_id IN ({placeholders})
        )
    ''', session_ids)
    messages_deleted = cursor.rowcount

    # Delete prompts for old sessions
    cursor = conn.execute(f'''
        DELETE FROM prompts WHERE session_id IN ({placeholders})
    ''', session_ids)
    prompts_deleted = cursor.rowcount

    # Delete old sessions
    cursor = conn.execute(f'''
        DELETE FROM sessions WHERE session_id IN ({placeholders})
    ''', session_ids)
    sessions_deleted = cursor.rowcount

    return messages_deleted + prompts_deleted + sessions_deleted


def delete_old_messages(conn) -> int:
    """Delete messages older than 3 days. Returns count deleted."""
    cursor = conn.execute('''
        DELETE FROM messages WHERE created_at < datetime('now', '-3 days')
    ''')
    return cursor.rowcount


def delete_orphan_projects(conn) -> int:
    """Delete projects with no sessions. Returns count deleted."""
    cursor = conn.execute('''
        DELETE FROM projects
        WHERE id NOT IN (SELECT DISTINCT project_id FROM sessions)
    ''')
    return cursor.rowcount


def delete_empty_sessions(conn) -> int:
    """Delete sessions with only a single null prompt and no messages. Returns count deleted."""
    # Find sessions that have exactly one prompt, that prompt is null, and has no messages
    cursor = conn.execute('''
        DELETE FROM sessions WHERE session_id IN (
            SELECT s.session_id
            FROM sessions s
            JOIN prompts p ON p.session_id = s.session_id
            LEFT JOIN messages m ON m.prompt_id = p.id
            GROUP BY s.session_id
            HAVING COUNT(DISTINCT p.id) = 1
               AND MAX(p.prompt) IS NULL
               AND COUNT(m.id) = 0
        )
    ''')
    sessions_deleted = cursor.rowcount

    # Clean up orphaned prompts (prompts without sessions)
    conn.execute('''
        DELETE FROM prompts WHERE session_id NOT IN (SELECT session_id FROM sessions)
    ''')

    return sessions_deleted


def cleanup_stale_files(directory: Path, max_age: int) -> int:
    """Delete files older than max_age seconds. Returns count deleted."""
    if not directory.exists():
        return 0

    deleted = 0
    now = time.time()

    for f in directory.iterdir():
        if f.is_file():
            try:
                if now - f.stat().st_mtime > max_age:
                    f.unlink()
                    deleted += 1
            except (OSError, FileNotFoundError):
                pass

    return deleted


def run_data_cleanup(conn) -> None:
    """Run database data cleanup (weekly)."""

    delete_empty_sessions(conn)
    delete_orphan_projects(conn)

    if has_recent_cleanup(conn, 'data', DATA_CLEANUP_INTERVAL):
        return

    record_cleanup(conn, 'data')

    delete_old_messages(conn)
    delete_old_logs_and_hooks(conn)
    delete_old_session_data(conn)

    conn.commit()


def run_locks_cleanup(conn) -> None:
    """Run locks/debounce file cleanup (hourly)."""
    if has_recent_cleanup(conn, 'locks', LOCKS_CLEANUP_INTERVAL):
        return

    record_cleanup(conn, 'locks')

    cleanup_stale_files(DEBOUNCE_DIR, LOCKS_FILE_MAX_AGE)
    cleanup_stale_files(LOCKS_DIR, LOCKS_FILE_MAX_AGE)


def run_cleanup() -> None:
    """Run all cleanup processes."""
    conn = init_db()

    run_data_cleanup(conn)
    run_locks_cleanup(conn)

    conn.close()


if __name__ == "__main__":
    run_cleanup()
