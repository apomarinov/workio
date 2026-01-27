#!/usr/bin/env python3
"""
Debounced async worker for processing session jobs.
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from db import (
    get_db, log,
    get_session, get_latest_prompt, update_prompt_text,
    message_exists, create_message, get_latest_user_message
)
from socket_worker import emit_event

DEBOUNCE_DIR = Path(__file__).parent / "debounce"
DEBOUNCE_SECONDS = int(os.environ.get("DEBOUNCE_SECONDS", 2))


def process_transcript(conn, session_id: str, transcript_path: str) -> None:
    """Process transcript file and store messages."""
    if not transcript_path:
        log(conn, "No transcript path provided", session_id=session_id)
        return

    transcript_file = Path(transcript_path)
    if not transcript_file.exists():
        log(conn, "Transcript file not found", session_id=session_id, path=transcript_path)
        return

    # Get the latest prompt for this session
    prompt_row = get_latest_prompt(conn, session_id)

    if not prompt_row:
        log(conn, "No prompt found for session", session_id=session_id)
        return

    prompt_id = prompt_row['id']
    messages_added = 0

    with open(transcript_file, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            entry_type = entry.get('type')
            message = entry.get('message', {})
            uuid = entry.get('uuid')
            timestamp = entry.get('timestamp')

            if not uuid:
                continue

            # Check if message already exists
            if message_exists(conn, uuid):
                continue

            body = None
            is_thinking = False
            is_user = False

            # User message (only string content, skip tool_results which are lists)
            if entry_type == 'user' and message.get('role') == 'user':
                content = message.get('content', '')
                if isinstance(content, str) and len(content) > 0:
                    # Skip local command messages
                    if '<local-command-stdout>' in content or '<local-command-caveat>' in content or '<command-name>' in content:
                        continue
                    body = content
                    is_user = True

            # Assistant message
            elif entry_type == 'assistant' and message.get('role') == 'assistant' and message.get('type') == 'message':
                content_list = message.get('content', [])
                if content_list and len(content_list) > 0:
                    first_content = content_list[0]
                    content_type = first_content.get('type')

                    if content_type == 'thinking':
                        body = first_content.get('thinking')
                        is_thinking = True
                    elif content_type == 'text':
                        body = first_content.get('text')

            # Store message if we have body
            if body:
                create_message(conn, prompt_id, uuid, timestamp, body, is_thinking, is_user)
                messages_added += 1

    log(conn, "Processed transcript", session_id=session_id, messages_added=messages_added)

    # If latest prompt has no prompt text, set it to newest user message
    latest_prompt = get_latest_prompt(conn, session_id)

    if latest_prompt and not latest_prompt['prompt']:
        user_msg = get_latest_user_message(conn, latest_prompt['id'])

        if user_msg:
            update_prompt_text(conn, latest_prompt['id'], user_msg['body'])
            log(conn, "Set prompt from user message", session_id=session_id)


def process_session(session_id: str, timestamp: str) -> None:
    """Process a session job after debounce period."""
    conn = None
    try:
        conn = get_db()

        log(conn, "Worker started", session_id=session_id, timestamp=timestamp)
        conn.commit()

        # Sleep for debounce period
        time.sleep(DEBOUNCE_SECONDS)

        # Check if our timestamp is still current
        marker_file = DEBOUNCE_DIR / f"{session_id}.marker"

        if not marker_file.exists():
            log(conn, "Marker file not found, skipping", session_id=session_id)
            conn.commit()
            conn.close()
            return

        try:
            marker_data = json.loads(marker_file.read_text())
            start_timestamp = marker_data.get('start', '')
            latest_timestamp = marker_data.get('latest', '')
        except (json.JSONDecodeError, KeyError):
            log(conn, "Invalid marker file, skipping", session_id=session_id)
            conn.commit()
            conn.close()
            return

        # Check if we're the latest event
        is_latest = (latest_timestamp == timestamp)

        # Check if debounce period has passed since start
        try:
            start_time = datetime.fromisoformat(start_timestamp)
            elapsed = (datetime.now() - start_time).total_seconds()
            debounce_expired = elapsed >= DEBOUNCE_SECONDS
        except ValueError:
            debounce_expired = False

        if not is_latest and not debounce_expired:
            # Newer event came in and debounce hasn't expired, let that one handle it
            log(conn, "Newer event detected, skipping", session_id=session_id, our_timestamp=timestamp, latest_timestamp=latest_timestamp)
            conn.commit()
            conn.close()
            return

        # Wait for lock if another worker is processing
        lock_file = DEBOUNCE_DIR / f"{session_id}.lock"
        lock_timeout = DEBOUNCE_SECONDS * 30  # Stale lock timeout
        lock_wait_interval = 1  # Check every second

        while lock_file.exists():
            try:
                lock_time = datetime.fromisoformat(lock_file.read_text().strip())
                lock_age = (datetime.now() - lock_time).total_seconds()
                if lock_age >= lock_timeout:
                    # Lock is stale, remove it and break
                    lock_file.unlink()
                    break
                # Wait and retry
                log(conn, "Waiting for lock", session_id=session_id, lock_age=lock_age)
                conn.commit()
                time.sleep(lock_wait_interval)
            except (ValueError, FileNotFoundError):
                break

        # Acquire lock
        lock_file.write_text(datetime.now().isoformat())

        try:
            # Re-check marker after acquiring lock - a newer worker may have processed already
            if not marker_file.exists():
                log(conn, "Marker file gone after lock acquired, skipping", session_id=session_id)
                conn.commit()
                conn.close()
                return

            # We're either the latest OR debounce has expired - process the job
            log(conn, "Debounced job processing", session_id=session_id, is_latest=is_latest, debounce_expired=debounce_expired)

            # Get transcript_path from session
            session = get_session(conn, session_id)


            log(conn, "Debounced job completed", session_id=session_id)
            conn.commit()
            conn.close()
            
            if session and session['transcript_path']:
                process_transcript(conn, session_id, session['transcript_path'])
                # Fire session_update event to notify frontend of new messages
                emit_event("session_update", {"session_id": session_id})
            else:
                log(conn, "No transcript path in session", session_id=session_id)

            # Clean up marker file only if no new events came in during processing
            try:
                current_marker = json.loads(marker_file.read_text())
                if current_marker.get('latest') == latest_timestamp:
                    # No new events - safe to delete
                    marker_file.unlink()
                else:
                    # New event arrived during processing - leave marker for that worker
                    pass
            except (FileNotFoundError, json.JSONDecodeError):
                pass
        finally:
            # Release lock
            try:
                lock_file.unlink()
            except FileNotFoundError:
                pass

    except Exception as e:
        # Log error to database if connection exists
        if conn:
            try:
                log(conn, "Worker error", error=str(e), error_type=type(e).__name__, session_id=session_id)
                conn.commit()
                conn.close()
            except Exception:
                pass
        raise RuntimeError("Worker failed") from e


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: worker.py <session_id> <timestamp>", file=sys.stderr)
        sys.exit(1)

    session_id = sys.argv[1]
    timestamp = sys.argv[2]
    process_session(session_id, timestamp)
