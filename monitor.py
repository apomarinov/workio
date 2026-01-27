#!/usr/bin/env python3
"""
Claude Code Hook Monitor

Receives events from Claude Code hooks and stores them for the dashboard.
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from notify import notify
from dotenv import load_dotenv
from db import (
    init_db, log, save_hook,
    upsert_project, update_project_path_by_session,
    upsert_session, update_session_metadata, update_session_name_if_empty,
    get_stale_session_ids, delete_sessions_cascade,
    get_session_project_path,
    create_prompt
)


# Load environment variables
for env_file in [".env", ".env.local"]:
    load_dotenv(Path(__file__).parent / env_file, override=True)

DEBOUNCE_DIR = Path(__file__).parent / "debounce"


def start_debounced_worker(session_id: str) -> None:
    """Start a debounced worker for a session."""
    DEBOUNCE_DIR.mkdir(exist_ok=True)

    marker_file = DEBOUNCE_DIR / f"{session_id}.marker"
    now = datetime.now().isoformat()

    # Read existing marker to preserve start timestamp
    start_timestamp = now
    if marker_file.exists():
        try:
            data = json.loads(marker_file.read_text())
            start_timestamp = data.get('start', now)
        except (json.JSONDecodeError, KeyError):
            pass

    # Write marker with start and latest timestamps
    marker_file.write_text(json.dumps({
        'start': start_timestamp,
        'latest': now
    }))

    # Spawn worker
    subprocess.Popen(
        [sys.executable, Path(__file__).parent / "worker.py", session_id, now],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )


def start_cleanup_worker() -> None:
    """Start the cleanup worker."""
    subprocess.Popen(
        [sys.executable, Path(__file__).parent / "cleanup_worker.py"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )


def start_socket_worker(session_id: str, event: str, data: dict) -> None:
    """Start a socket worker to emit an event."""
    subprocess.Popen(
        [
            sys.executable,
            Path(__file__).parent / "socket_worker.py",
            session_id,
            event,
            json.dumps(data)
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )


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


def update_session_from_index(conn, project_path: str, session_id: str) -> None:
    """Update session metadata from Claude's sessions-index.json."""
    entry = get_session_index_entry(project_path, session_id)
    if not entry:
        log(conn, "No session entry found in index", session_id=session_id, project_path=project_path)
        return

    name = entry.get('customTitle') or entry.get('firstPrompt')
    git_branch = entry.get('gitBranch')
    message_count = entry.get('messageCount')

    log(conn, "Updating session metadata from index", session_id=session_id, project_path=project_path, name=name, git_branch=git_branch, message_count=message_count)
    update_session_metadata(conn, session_id, name, git_branch, message_count)


def clean_sessions(conn, project_id: int, current_session_id: str) -> None:
    """Remove stale sessions in 'started' status for this project and related data."""
    session_ids = get_stale_session_ids(conn, project_id, current_session_id)
    delete_sessions_cascade(conn, session_ids)


def main() -> None:
    conn = None
    try:
        conn = init_db()

        try:
            event = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            log(conn, "Invalid Hook Event", error=str(e), error_type=type(e).__name__)
            print(json.dumps({"continue": True}))
            return


        session_id = event.get('session_id', 'unknown')
        project_path = event.get('cwd', '')
        hook_type = event.get('hook_event_name', '')

        log(conn, "Received hook event", hook_type=hook_type, session_id=session_id, payload=event, terminal_id=os.environ.get('CLAUDE_TERMINAL_ID'))
        save_hook(conn, session_id, hook_type, event)

        # Determine session status
        status = None

        if hook_type == 'SessionStart':
            status = 'started'
        elif hook_type == 'UserPromptSubmit':
            status = 'active'
        elif hook_type == 'PreToolUse':
            status = 'active'
        elif hook_type == 'PostToolUse':
            status = 'active'
        elif hook_type == 'Stop':
            status = 'done'
        elif hook_type == 'SessionEnd':
            status = 'ended'
        elif hook_type == 'Notification':
            notification_type = event.get('notification_type', '')
            if notification_type == 'permission_prompt':
                status = 'permission_needed'
            elif notification_type == 'idle_prompt':
                status = 'idle'

        project_id = upsert_project(conn, project_path)

        # Update session if we have a status
        transcript_path = event.get('transcript_path', '')
        terminal_id_str = os.environ.get('CLAUDE_TERMINAL_ID')
        terminal_id = int(terminal_id_str) if terminal_id_str else None
        if status:
            upsert_session(conn, session_id, project_id, status, transcript_path, terminal_id)

        if hook_type == 'SessionStart':
            clean_sessions(conn, project_id, session_id)
            # Create prompt on session start
            create_prompt(conn, session_id)
            log(conn, "Created prompt", session_id=session_id)

        # Update session metadata using stored project path (not current cwd)
        if hook_type in ('SessionStart', 'UserPromptSubmit'):
            stored_path = get_session_project_path(conn, session_id) or project_path
            update_session_from_index(conn, stored_path, session_id)

        # Create prompt on user prompt submit
        if hook_type == 'UserPromptSubmit':
            prompt_text = event.get('prompt', '')
            create_prompt(conn, session_id, prompt_text)
            update_session_name_if_empty(conn, session_id, prompt_text)
            log(conn, "Created prompt", session_id=session_id, prompt_length=len(prompt_text))

        conn.commit()
        conn.close()

        # Send notification if permission is needed
        if status == 'permission_needed':
            project_name = Path(project_path).name if project_path else 'Unknown'
            notify(project_name, "Permission Request")

        # Emit hook event to connected clients
        terminal_id_str = os.environ.get('CLAUDE_TERMINAL_ID')
        terminal_id = int(terminal_id_str) if terminal_id_str else None
        start_socket_worker(session_id, "hook", {
            "session_id": session_id,
            "hook_type": hook_type,
            "status": status,
            "project_path": project_path,
            "terminal_id": terminal_id,
        })

        # Start debounced worker for session processing
        start_debounced_worker(session_id)

        # Start cleanup worker (skip on SessionStart to avoid race condition
        # where newly created session with null prompt gets deleted)
        if hook_type != 'SessionStart':
            start_cleanup_worker()

        print(json.dumps({"continue": True}))

    except Exception as e:
        # Log error to database if connection exists
        if conn:
            try:
                log(conn, "Monitor error", error=str(e), error_type=type(e).__name__)
                conn.commit()
                conn.close()
            except Exception:
                pass
        raise RuntimeError("Claude Dashboard Error") from e


if __name__ == "__main__":
    main()
