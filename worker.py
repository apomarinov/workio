#!/usr/bin/env python3
"""
Debounced async worker for processing session jobs.
"""

import difflib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from db import (
    get_db, log, notify,
    get_session, get_latest_prompt, update_prompt_text,
    message_exists, create_message, get_latest_user_message, upsert_todo_message,
    compute_state_key, compute_todo_hash, update_session_name_if_empty
)

DEBOUNCE_DIR = Path(__file__).parent / "debounce"
DEBOUNCE_SECONDS = int(os.environ.get("DEBOUNCE_SECONDS", 2))

# Tool processing constants
MAX_OUTPUT_LENGTH = 50000      # Max chars for command output
MAX_DIFF_LENGTH = 50000         # Max chars for diff content
MAX_CONTENT_LENGTH = 50000     # Max chars for file content


def truncate_output(text: str, max_length: int) -> tuple[str, bool]:
    """Truncate text if too long. Returns (text, was_truncated)."""
    if not text:
        return "", False
    if len(text) <= max_length:
        return text, False
    return text[:max_length] + "\n... [truncated]", True


def generate_diff(old_string: str, new_string: str, file_path: str) -> tuple[str, int, int]:
    """
    Generate unified diff and count lines changed.
    Returns: (diff_text, lines_added, lines_removed)
    """
    try:
        if not old_string and not new_string:
            return "", 0, 0

        old_lines = (old_string or "").splitlines(keepends=True)
        new_lines = (new_string or "").splitlines(keepends=True)

        # Get just the filename for shorter diff headers
        filename = Path(file_path).name if file_path else "file"

        diff = difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{filename}",
            tofile=f"b/{filename}",
            lineterm=""
        )

        diff_text = "".join(diff)

        # Count additions and deletions
        lines_added = sum(1 for line in diff_text.splitlines() if line.startswith('+') and not line.startswith('+++'))
        lines_removed = sum(1 for line in diff_text.splitlines() if line.startswith('-') and not line.startswith('---'))

        return diff_text, lines_added, lines_removed
    except Exception as e:
        return f"[Error generating diff: {str(e)}]", 0, 0


def build_tool_json(tool_use: dict, result: dict) -> dict | None:
    """Build the tool JSON structure based on tool type."""
    try:
        name = tool_use.get('name')
        if not name:
            return None

        input_data = tool_use.get('input') or {}
        result_content = result.get('content', '')
        is_error = result.get('is_error', False)

        # Extract text from result content (can be string or list)
        output_text = ""
        try:
            if isinstance(result_content, list):
                for item in result_content:
                    if isinstance(item, dict) and item.get('type') == 'text':
                        output_text += item.get('text', '')
            elif result_content:
                output_text = str(result_content)
        except Exception:
            output_text = "[Error extracting output]"

        base = {
            'tool_use_id': tool_use.get('tool_use_id', ''),
            'name': name,
            'status': 'error' if is_error else 'success',
        }

        if name == 'Bash':
            output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
            return {
                **base,
                'input': {
                    'command': input_data.get('command', ''),
                    'description': input_data.get('description'),
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'Edit':
            old_string = input_data.get('old_string') or ''
            new_string = input_data.get('new_string') or ''
            file_path = input_data.get('file_path') or ''

            diff_text, lines_added, lines_removed = generate_diff(old_string, new_string, file_path)

            diff_truncated = False
            if len(diff_text) > MAX_DIFF_LENGTH:
                diff_text = "[Diff too large to display]"
                diff_truncated = True

            return {
                **base,
                'input': {
                    'file_path': file_path,
                    'replace_all': input_data.get('replace_all', False),
                },
                'diff': diff_text,
                'lines_added': lines_added,
                'lines_removed': lines_removed,
                'diff_truncated': diff_truncated,
            }

        elif name == 'Read':
            # Don't store file content - just track that the read happened
            return {
                **base,
                'input': {
                    'file_path': input_data.get('file_path') or '',
                    'offset': input_data.get('offset'),
                    'limit': input_data.get('limit'),
                },
                'output_truncated': len(output_text) > MAX_CONTENT_LENGTH,
            }

        elif name == 'Write':
            content = input_data.get('content') or ''
            content, truncated = truncate_output(content, MAX_CONTENT_LENGTH)
            return {
                **base,
                'input': {
                    'file_path': input_data.get('file_path') or '',
                },
                'content': content,
                'content_truncated': truncated,
            }

        elif name in ('Grep', 'Glob'):
            output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
            return {
                **base,
                'input': {
                    'pattern': input_data.get('pattern') or input_data.get('glob') or '',
                    'path': input_data.get('path'),
                    'glob': input_data.get('glob'),
                    'output_mode': input_data.get('output_mode'),
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'Task':
            output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
            return {
                **base,
                'input': {
                    'description': input_data.get('description') or '',
                    'subagent_type': input_data.get('subagent_type') or '',
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'TodoWrite':
            todos = input_data.get('todos') or []
            if not isinstance(todos, list):
                todos = []
            state_key = compute_state_key(todos)
            return {
                **base,
                'input': {
                    'todos': todos,
                },
                'state_key': state_key,
            }

        # Generic fallback for other/unknown tools
        output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
        return {
            **base,
            'input': input_data,
            'output': output,
            'output_truncated': truncated,
        }

    except Exception as e:
        return {
            'tool_use_id': tool_use.get('tool_use_id', ''),
            'name': tool_use.get('name', 'Unknown'),
            'status': 'error',
            'input': {},
            'output': f"[Error processing tool: {str(e)}]",
            'output_truncated': False,
        }


def process_transcript(conn, session_id: str, transcript_path: str) -> list[dict]:
    """Process transcript file and store messages. Returns list of new messages."""
    if not transcript_path:
        log(conn, "No transcript path provided", session_id=session_id)
        return []

    transcript_file = Path(transcript_path)
    if not transcript_file.exists():
        log(conn, "Transcript file not found", session_id=session_id, path=transcript_path)
        return []

    # Get the latest prompt for this session
    prompt_row = get_latest_prompt(conn, session_id)

    if not prompt_row:
        log(conn, "No prompt found for session", session_id=session_id)
        return []

    prompt_id = prompt_row['id']
    prompt_text = prompt_row['prompt']
    new_messages = []

    # Read all entries first for two-pass tool processing
    entries = []
    try:
        with open(transcript_file, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                except json.JSONDecodeError:
                    continue
    except IOError as e:
        log(conn, "Error reading transcript file", session_id=session_id, error=str(e))
        return []

    # Pass 1: Collect tool_uses from assistant messages
    tool_uses = {}  # tool_use_id -> {tool_use_id, timestamp, name, input}
    for entry in entries:
        try:
            if entry.get('type') == 'assistant':
                msg = entry.get('message', {})
                content_list = msg.get('content', [])
                if not isinstance(content_list, list):
                    continue
                for item in content_list:
                    if isinstance(item, dict) and item.get('type') == 'tool_use':
                        tool_use_id = item.get('id')
                        if not tool_use_id:
                            continue
                        tool_uses[tool_use_id] = {
                            'tool_use_id': tool_use_id,
                            'timestamp': entry.get('timestamp'),
                            'name': item.get('name'),
                            'input': item.get('input') or {}
                        }
        except Exception as e:
            log(conn, "Error processing assistant entry for tools", session_id=session_id, error=str(e))
            continue

    # Pass 2: Collect tool_results from user messages
    tool_results = {}  # tool_use_id -> {content, is_error}
    for entry in entries:
        try:
            if entry.get('type') == 'user':
                msg = entry.get('message', {})
                content = msg.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'tool_result':
                            tool_use_id = item.get('tool_use_id')
                            if not tool_use_id:
                                continue
                            tool_results[tool_use_id] = {
                                'content': item.get('content'),
                                'is_error': item.get('is_error', False)
                            }
                            # Capture AskUserQuestion answers if present
                            tool_use_result = entry.get('toolUseResult')
                            if isinstance(tool_use_result, dict) and 'answers' in tool_use_result:
                                tool_results[tool_use_id]['answers'] = tool_use_result['answers']
        except Exception as e:
            log(conn, "Error processing user entry for tools", session_id=session_id, error=str(e))
            continue

    # Pass 2.5: Deduplicate TodoWrite entries - keep only the LAST one per todo_hash
    # This prevents re-emitting all state transitions on reprocessing
    todo_final_states = {}  # todo_hash -> tool_use_id (latest)
    for tool_use_id, tool_use in tool_uses.items():
        if tool_use.get('name') == 'TodoWrite':
            todos = tool_use.get('input', {}).get('todos', [])
            todo_hash = compute_todo_hash(session_id, todos)
            # Later entries overwrite earlier ones, so we keep the final state
            todo_final_states[todo_hash] = tool_use_id

    # Set of TodoWrite tool_use_ids that are the final state for their todo_hash
    final_todo_ids = set(todo_final_states.values())

    # Pass 3: Process matched tool calls and create tool messages
    for tool_use_id, tool_use in tool_uses.items():
        try:
            result = tool_results.get(tool_use_id, {})
            tool_json = build_tool_json(tool_use, result)

            if not tool_json:
                continue

            # Merge AskUserQuestion answers into tool JSON
            answers = result.get('answers')
            if answers:
                tool_json['answers'] = answers

            tool_name = tool_use.get('name')
            tools_str = json.dumps(tool_json)

            if tool_name == 'TodoWrite':
                # Skip non-final TodoWrite entries (we only process the last one per todo_hash)
                if tool_use_id not in final_todo_ids:
                    continue

                # TodoWrite uses upsert - updates existing or creates new based on content hash
                todos = tool_use.get('input', {}).get('todos', [])
                state_key = tool_json.get('state_key', '')
                msg_id, todo_id, is_new, state_changed = upsert_todo_message(
                    conn,
                    session_id=session_id,
                    prompt_id=prompt_id,
                    uuid=tool_use_id,
                    created_at=tool_use.get('timestamp'),
                    tools=tools_str,
                    todos=todos,
                    state_key=state_key
                )
                # Emit if message was created (is_new) or updated (state_changed)
                if is_new or state_changed:
                    new_messages.append({
                        'id': msg_id,
                        'prompt_id': prompt_id,
                        'uuid': tool_use_id,
                        'is_user': False,
                        'thinking': False,
                        'todo_id': todo_id,
                        'body': None,
                        'tools': tool_json,
                        'created_at': tool_use.get('timestamp'),
                        'prompt_text': None,
                    })
            else:
                # Regular tool call - skip if already exists
                if message_exists(conn, tool_use_id):
                    continue

                msg_id = create_message(
                    conn, prompt_id,
                    uuid=tool_use_id,
                    created_at=tool_use.get('timestamp'),
                    body=None,
                    is_thinking=False,
                    is_user=False,
                    tools=tools_str
                )
                new_messages.append({
                    'id': msg_id,
                    'prompt_id': prompt_id,
                    'uuid': tool_use_id,
                    'is_user': False,
                    'thinking': False,
                    'todo_id': None,
                    'body': None,
                    'tools': tool_json,
                    'created_at': tool_use.get('timestamp'),
                    'prompt_text': None,
                })
        except Exception as e:
            log(conn, "Error processing tool call", session_id=session_id, tool_id=tool_use_id, error=str(e))
            continue

    # Pass 4: Process text messages (user and assistant)
    for entry in entries:
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
        images_json = None

        # User message - can be string or list with text and image items
        if entry_type == 'user' and message.get('role') == 'user':
            content = message.get('content', '')
            text_parts = []
            images = []

            if isinstance(content, str) and len(content) > 0:
                text_parts.append(content)
            elif isinstance(content, list):
                # Collect all text items and image items
                for item in content:
                    if isinstance(item, dict):
                        item_type = item.get('type')
                        if item_type == 'text':
                            text = item.get('text', '')
                            if text:
                                text_parts.append(text)
                        elif item_type == 'image':
                            source = item.get('source', {})
                            if source.get('data'):
                                images.append({
                                    'media_type': source.get('media_type', 'image/png'),
                                    'data': source.get('data')
                                })

            text_content = '\n'.join(text_parts) if text_parts else None

            if text_content or images:
                # Skip local command messages
                if text_content and ('<local-command-stdout>' in text_content or '<local-command-caveat>' in text_content or '<command-name>' in text_content):
                    continue
                body = text_content
                is_user = True
                if images:
                    images_json = json.dumps(images)

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

        # Store message if we have body or images
        if body or images_json:
            msg_id = create_message(conn, prompt_id, uuid, timestamp, body, is_thinking, is_user, images=images_json)
            new_messages.append({
                'id': msg_id,
                'prompt_id': prompt_id,
                'uuid': uuid,
                'is_user': is_user,
                'thinking': is_thinking,
                'todo_id': None,
                'body': body,
                'tools': None,
                'images': json.loads(images_json) if images_json else None,
                'created_at': timestamp,
                'prompt_text': prompt_text if is_user else None,
            })

    # Check for custom-title entry to update session name (use the last one)
    custom_title = None
    for entry in entries:
        if entry.get('type') == 'custom-title' and entry.get('customTitle'):
            custom_title = entry.get('customTitle')
    if custom_title:
        cur = conn.cursor()
        cur.execute(
            'UPDATE sessions SET name = %s WHERE session_id = %s',
            (custom_title, session_id)
        )
    else:
        # Fall back to first user message body as session name
        first_user_body = next(
            (m['body'] for m in new_messages if m['is_user'] and m['body']),
            None
        )
        if first_user_body:
            update_session_name_if_empty(conn, session_id, first_user_body)

    log(conn, "Processed transcript", session_id=session_id, messages_added=len(new_messages))

    # If latest prompt has no prompt text, set it to newest user message
    latest_prompt = get_latest_prompt(conn, session_id)

    if latest_prompt and not latest_prompt['prompt']:
        user_msg = get_latest_user_message(conn, latest_prompt['id'])

        if user_msg:
            update_prompt_text(conn, latest_prompt['id'], user_msg['body'])
            log(conn, "Set prompt from user message", session_id=session_id)

    return new_messages


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

            if session and session['transcript_path']:
                new_messages = process_transcript(conn, session_id, session['transcript_path'])
                # Notify frontend of new messages via PostgreSQL NOTIFY
                if new_messages:
                    message_ids = [m['id'] for m in new_messages]
                    notify(conn, "session_update", {
                        "session_id": session_id,
                        "message_ids": message_ids,
                    })
            else:
                log(conn, "No transcript path in session", session_id=session_id)

            log(conn, "Debounced job completed", session_id=session_id)
            conn.commit()
            conn.close()

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
