#!/usr/bin/env python3
"""
Backfill summaries for all messages in the database.
Processes messages concurrently with a limit of 5 at a time.
"""

import json
from concurrent.futures import ThreadPoolExecutor, as_completed

from db import get_db, get_cursor

CONCURRENCY_LIMIT = 10


def get_messages_without_summary(conn):
    """Get all messages that don't have a summary."""
    cur = get_cursor(conn)
    cur.execute('''
        SELECT id, body, is_user, thinking
        FROM messages
        WHERE is_user = FALSE AND body IS NOT NULL AND length(body) > 60
        LIMIT 30
    ''')
    return cur.fetchall()


def update_message_summary(message_id: int, summary_json: str) -> None:
    """Update a message's summary."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE messages SET summary = %s WHERE id = %s',
        (summary_json, message_id)
    )
    conn.commit()
    conn.close()


def process_message(message) -> dict:
    """Process a single message and return result."""
    message_id = message['id']
    body = message['body']
    is_user = message['is_user']
    is_thinking = message['thinking']

    try:
        if is_user:
            result = summarize_user(body)
        else:
            result = summarize_assistant(body, thinking=is_thinking)

        summary_json = json.dumps(result)
        update_message_summary(message_id, summary_json)

        return {
            'id': message_id,
            'success': True,
            'error': result.get('error')
        }
    except Exception as e:
        return {
            'id': message_id,
            'success': False,
            'error': str(e)
        }


def main():
    conn = get_db()
    messages = get_messages_without_summary(conn)
    conn.close()

    total = len(messages)
    print(f"Found {total} messages to process")

    if total == 0:
        return

    completed = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=CONCURRENCY_LIMIT) as executor:
        futures = {executor.submit(process_message, msg): msg for msg in messages}

        for future in as_completed(futures):
            result = future.result()
            completed += 1

            if result['success']:
                status = "OK" if not result['error'] else f"OK (with error: {result['error']})"
            else:
                status = f"FAILED: {result['error']}"
                errors += 1

            print(f"[{completed}/{total}] Message {result['id']}: {status}")

    print(f"\nDone. Processed {completed} messages, {errors} errors.")


if __name__ == "__main__":
    from summary import summarize_user, summarize_assistant
    main()
