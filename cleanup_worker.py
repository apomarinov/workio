#!/usr/bin/env python3
"""
Cleanup worker for removing old data from the database and stale files.
"""

import time
from pathlib import Path

from db import get_db, log, get_cursor, notify

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


def get_favorite_session_ids(conn) -> set[str]:
    """Get the set of favorited session IDs from settings."""
    cur = get_cursor(conn)
    cur.execute("SELECT config->'favorite_sessions' AS favs FROM settings WHERE id = 1")
    row = cur.fetchone()
    if row and row['favs']:
        return set(row['favs'])
    return set()


def delete_orphan_projects(conn) -> int:
    """Delete projects with no sessions. Returns count deleted."""
    cur = conn.cursor()
    cur.execute('''
        DELETE FROM projects
        WHERE id NOT IN (SELECT DISTINCT project_id FROM sessions)
    ''')
    return cur.rowcount


def delete_empty_sessions(conn) -> tuple[int, list[str]]:
    """Delete sessions with no prompts, or only a single null prompt and no messages. Returns (count deleted, deleted session IDs)."""
    cur = get_cursor(conn)
    favorite_ids = list(get_favorite_session_ids(conn))

    # Find sessions that have no prompts, or exactly one null prompt with no messages
    cur.execute('''
        DELETE FROM sessions WHERE session_id IN (
            SELECT s.session_id
            FROM sessions s
            LEFT JOIN prompts p ON p.session_id = s.session_id
            LEFT JOIN messages m ON m.prompt_id = p.id
            WHERE s.session_id != ALL(%s)
            GROUP BY s.session_id
            HAVING COUNT(DISTINCT p.id) <= 1
               AND MAX(p.prompt) IS NULL
               AND COUNT(m.id) = 0
        )
        RETURNING session_id
    ''', (favorite_ids,))
    deleted_ids = [row['session_id'] for row in cur.fetchall()]

    # Clean up orphaned prompts (prompts without sessions)
    cur.execute('''
        DELETE FROM prompts WHERE session_id NOT IN (SELECT session_id FROM sessions)
    ''')

    return len(deleted_ids), deleted_ids


def end_stale_sessions(conn) -> int:
    """Set active sessions to 'ended' if not updated in 5 minutes. Returns count updated."""
    cur = conn.cursor()
    cur.execute('''
        UPDATE sessions SET status = 'ended'
        WHERE status IN ('started', 'active', 'permission_needed')
          AND updated_at < NOW() - INTERVAL '5 minutes'
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
    """Run database data cleanup."""
    log(conn, "cleanup empty")
    end_stale_sessions(conn)
    _, empty_ids = delete_empty_sessions(conn)
    delete_orphan_projects(conn)

    if not has_recent_cleanup(conn, 'data', DATA_CLEANUP_INTERVAL):
        record_cleanup(conn, 'data')
        delete_old_logs_and_hooks(conn)

    if empty_ids:
        notify(conn, "sessions_deleted", {"session_ids": empty_ids})
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
