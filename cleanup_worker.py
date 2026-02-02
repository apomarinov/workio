#!/usr/bin/env python3
"""
Cleanup worker for removing old data from the database and stale files.
"""

import time
from pathlib import Path

from db import get_db, log, get_cursor

DEBOUNCE_DIR = Path(__file__).parent / "debounce"
LOCKS_DIR = Path(__file__).parent / "locks"

# Cleanup intervals
DATA_CLEANUP_INTERVAL = '7 days'
LOCKS_CLEANUP_INTERVAL = '1 hours'
LOCKS_FILE_MAX_AGE = 3600  # 1 hour in seconds


def has_recent_cleanup(conn, cleanup_type: str, interval: str) -> bool:
    """Check if there's a cleanup of this type within the interval."""
    cur = get_cursor(conn)
    cur.execute('''
        SELECT id FROM cleans
        WHERE type = %s AND created_at > NOW() - %s::interval
        LIMIT 1
    ''', (cleanup_type, interval))
    return cur.fetchone() is not None


def record_cleanup(conn, cleanup_type: str) -> None:
    """Record a cleanup of a specific type."""
    cur = conn.cursor()
    cur.execute('INSERT INTO cleans (type) VALUES (%s)', (cleanup_type,))
    conn.commit()


def delete_old_logs_and_hooks(conn) -> int:
    """Delete logs and hooks older than a week. Returns count deleted."""
    cur = conn.cursor()
    cur.execute('''
        DELETE FROM logs WHERE created_at < NOW() - INTERVAL '7 days'
    ''')
    logs_deleted = cur.rowcount

    cur.execute('''
        DELETE FROM hooks WHERE created_at < NOW() - INTERVAL '7 days'
    ''')
    hooks_deleted = cur.rowcount

    return logs_deleted + hooks_deleted


def delete_old_session_data(conn) -> int:
    """Delete messages and prompts for sessions older than a week. Returns count deleted."""
    cur = get_cursor(conn)
    # Get old session IDs
    cur.execute('''
        SELECT session_id FROM sessions
        WHERE updated_at < NOW() - INTERVAL '7 days'
    ''')
    old_sessions = cur.fetchall()

    if not old_sessions:
        return 0

    session_ids = [s['session_id'] for s in old_sessions]

    # Delete messages for old sessions' prompts
    cur.execute('''
        DELETE FROM messages WHERE prompt_id IN (
            SELECT id FROM prompts WHERE session_id = ANY(%s)
        )
    ''', (session_ids,))
    messages_deleted = cur.rowcount

    # Delete prompts for old sessions
    cur.execute('DELETE FROM prompts WHERE session_id = ANY(%s)', (session_ids,))
    prompts_deleted = cur.rowcount

    # Delete old sessions
    cur.execute('DELETE FROM sessions WHERE session_id = ANY(%s)', (session_ids,))
    sessions_deleted = cur.rowcount

    return messages_deleted + prompts_deleted + sessions_deleted


def delete_old_messages(conn) -> int:
    """Delete messages older than 3 days. Returns count deleted."""
    cur = conn.cursor()
    cur.execute('''
        DELETE FROM messages WHERE created_at < NOW() - INTERVAL '3 days'
    ''')
    return cur.rowcount


def delete_orphan_projects(conn) -> int:
    """Delete projects with no sessions. Returns count deleted."""
    cur = conn.cursor()
    cur.execute('''
        DELETE FROM projects
        WHERE id NOT IN (SELECT DISTINCT project_id FROM sessions)
    ''')
    return cur.rowcount


def delete_empty_sessions(conn) -> int:
    """Delete sessions with no prompts, or only a single null prompt and no messages. Returns count deleted."""
    cur = conn.cursor()
    # Find sessions that have no prompts, or exactly one null prompt with no messages
    cur.execute('''
        DELETE FROM sessions WHERE session_id IN (
            SELECT s.session_id
            FROM sessions s
            LEFT JOIN prompts p ON p.session_id = s.session_id
            LEFT JOIN messages m ON m.prompt_id = p.id
            GROUP BY s.session_id
            HAVING COUNT(DISTINCT p.id) <= 1
               AND MAX(p.prompt) IS NULL
               AND COUNT(m.id) = 0
        )
    ''')
    sessions_deleted = cur.rowcount

    # Clean up orphaned prompts (prompts without sessions)
    cur.execute('''
        DELETE FROM prompts WHERE session_id NOT IN (SELECT session_id FROM sessions)
    ''')

    return sessions_deleted


def end_stale_sessions(conn) -> int:
    """Set active sessions to 'ended' if not updated in 10 minutes. Returns count updated."""
    cur = conn.cursor()
    cur.execute('''
        UPDATE sessions SET status = 'ended'
        WHERE (status = 'started' or status = 'active')
          AND updated_at < NOW() - INTERVAL '10 minutes'
    ''')
    return cur.rowcount


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


    log(conn, "cleanup empty")
    end_stale_sessions(conn)
    delete_empty_sessions(conn)
    delete_orphan_projects(conn)

    if has_recent_cleanup(conn, 'data', DATA_CLEANUP_INTERVAL):
        log(conn, "skip old cleanup")
        conn.commit()
        return

    log(conn, "cleanup old")
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
    conn = get_db()

    log(conn, "cleanup process start")
    run_data_cleanup(conn)
    run_locks_cleanup(conn)

    conn.close()


if __name__ == "__main__":
    run_cleanup()
