#!/usr/bin/env python3
"""
Cleanup worker for removing old data from the database.
Runs at most once per week.
"""

from db import get_db


def has_recent_cleanup(conn) -> bool:
    """Check if there's a cleanup in the last week."""
    result = conn.execute('''
        SELECT id FROM cleans
        WHERE created_at > datetime('now', '-7 days')
        LIMIT 1
    ''').fetchone()
    return result is not None


def record_cleanup(conn) -> None:
    """Record a cleanup."""
    conn.execute('INSERT INTO cleans DEFAULT VALUES')
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


def run_cleanup() -> None:
    """Run the cleanup process."""
    conn = get_db()

    # Check if we've already cleaned up recently
    if has_recent_cleanup(conn):
        conn.close()
        return

    # Record this cleanup
    record_cleanup(conn)

    # Run cleanup tasks
    delete_old_messages(conn)
    delete_old_logs_and_hooks(conn)
    delete_old_session_data(conn)
    delete_orphan_projects(conn)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    run_cleanup()
