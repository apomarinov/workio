#!/usr/bin/env python3
"""
Persistent monitor daemon for Claude Code hook events.

Listens on a Unix socket, holds a single DB connection, and processes
hook events forwarded by the thin-client monitor.py.
Started by the Node.js server on startup.
"""

import json
import os
import signal
import socketserver
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables
SCRIPT_DIR = Path(__file__).parent
for env_file in [".env", ".env.local"]:
    load_dotenv(SCRIPT_DIR / env_file, override=True)

from db import (
    get_db, log, save_hook, notify,
    upsert_project,
    upsert_session, update_session_metadata, update_session_name_if_empty,
    get_stale_session_ids, delete_sessions_cascade,
    get_session_project_path,
    create_prompt
)

SOCKET_PATH = SCRIPT_DIR / "daemon.sock"
DEBOUNCE_DIR = SCRIPT_DIR / "debounce"

# Single DB connection + lock for thread safety
_db_conn = None
_db_lock = threading.Lock()


def get_conn():
    """Get the persistent DB connection, reconnecting if needed."""
    global _db_conn
    if _db_conn is None:
        _db_conn = get_db()
        return _db_conn
    try:
        cur = _db_conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        return _db_conn
    except Exception:
        try:
            _db_conn.close()
        except Exception:
            pass
        _db_conn = get_db()
        return _db_conn


def reset_conn():
    """Reset the DB connection after an error (rollback + reconnect on next use)."""
    global _db_conn
    if _db_conn is not None:
        try:
            _db_conn.rollback()
        except Exception:
            pass
        try:
            _db_conn.close()
        except Exception:
            pass
        _db_conn = None


# --- Hook processing logic (moved from monitor.py) ---

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
    message_count = entry.get('messageCount')

    log(conn, "Updating session metadata from index", session_id=session_id, project_path=project_path, name=name, message_count=message_count)
    update_session_metadata(conn, session_id, name, message_count)


def clean_sessions(conn, project_id: int, current_session_id: str) -> None:
    """Remove stale sessions in 'started' status for this project."""
    session_ids = get_stale_session_ids(conn, project_id, current_session_id)
    delete_sessions_cascade(conn, session_ids)
    if session_ids:
        notify(conn, "sessions_deleted", {"session_ids": session_ids})


def start_debounced_worker(session_id: str) -> None:
    """Start a debounced worker for a session."""
    DEBOUNCE_DIR.mkdir(exist_ok=True)

    marker_file = DEBOUNCE_DIR / f"{session_id}.marker"
    now = datetime.now().isoformat()

    start_timestamp = now
    if marker_file.exists():
        try:
            data = json.loads(marker_file.read_text())
            start_timestamp = data.get('start', now)
        except (json.JSONDecodeError, KeyError):
            pass

    marker_file.write_text(json.dumps({
        'start': start_timestamp,
        'latest': now
    }))

    subprocess.Popen(
        [sys.executable, SCRIPT_DIR / "worker.py", session_id, now],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )


def start_cleanup_worker() -> None:
    """Start the cleanup worker."""
    subprocess.Popen(
        [sys.executable, SCRIPT_DIR / "cleanup_worker.py"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )


def derive_project_path(transcript_path: str) -> str:
    """Derive project path from transcript path.

    Example:
        transcript: /Users/apo/.claude/projects/-Users-apo-code-workio/xxx.jsonl
        returns: /Users/apo/code/workio
    """
    if not transcript_path:
        return ''
    path = Path(transcript_path)
    encoded_path = path.parent.name  # e.g., '-Users-apo-code-workio'
    return encoded_path.replace('-', '/')


def process_event(event: dict, env: dict) -> dict:
    """Process a single hook event. Returns the response dict."""
    with _db_lock:
        conn = get_conn()
        try:
            session_id = event.get('session_id', 'unknown')
            transcript_path = event.get('transcript_path', '')
            project_path = derive_project_path(transcript_path) or event.get('cwd', '')
            hook_type = event.get('hook_event_name', '')
            terminal_id_str = env.get('CLAUDE_TERMINAL_ID')
            terminal_id = int(terminal_id_str) if terminal_id_str else None

            log(conn, "Received hook event", hook_type=hook_type, session_id=session_id, payload=event, terminal_id=terminal_id_str)
            save_hook(conn, session_id, hook_type, event)

            # Determine session status
            status = None
            if hook_type == 'SessionStart':
                status = 'started'
            elif hook_type in ('UserPromptSubmit', 'PreToolUse', 'PostToolUse'):
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

            if status:
                upsert_session(conn, session_id, project_id, status, transcript_path, terminal_id)

            if hook_type == 'SessionStart':
                clean_sessions(conn, project_id, session_id)
                create_prompt(conn, session_id)
                log(conn, "Created prompt", session_id=session_id)

            if hook_type in ('SessionStart', 'UserPromptSubmit'):
                stored_path = get_session_project_path(conn, session_id) or project_path
                update_session_from_index(conn, stored_path, session_id)

            if hook_type == 'UserPromptSubmit':
                prompt_text = event.get('prompt', '')
                create_prompt(conn, session_id, prompt_text)
                update_session_name_if_empty(conn, session_id, prompt_text)
                log(conn, "Created prompt", session_id=session_id, prompt_length=len(prompt_text))

            notify(conn, "hook", {
                "session_id": session_id,
                "hook_type": hook_type,
                "status": status,
                "project_path": project_path,
                "terminal_id": terminal_id,
            })

            conn.commit()

        except Exception as e:
            try:
                log(conn, "Daemon processing error", error=str(e), error_type=type(e).__name__)
                conn.commit()
            except Exception:
                reset_conn()
            return {"continue": True}

    # Post-commit actions (outside DB lock)
    start_debounced_worker(session_id)

    if hook_type != 'SessionStart':
        start_cleanup_worker()

    return {"continue": True}


# --- Socket server ---

class HookHandler(socketserver.StreamRequestHandler):
    """Handle a single hook event from the thin client."""

    def handle(self):
        try:
            line = self.rfile.readline()
            if not line:
                return

            message = json.loads(line)
            event = message.get('event', {})
            env = message.get('env', {})

            response = process_event(event, env)
            self.wfile.write(json.dumps(response).encode() + b'\n')
            self.wfile.flush()

        except json.JSONDecodeError:
            self.wfile.write(json.dumps({"continue": True}).encode() + b'\n')
            self.wfile.flush()
        except Exception as e:
            print(f"Handler error: {e}", file=sys.stderr)
            try:
                self.wfile.write(json.dumps({"continue": True}).encode() + b'\n')
                self.wfile.flush()
            except Exception:
                pass


class ThreadedUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def cleanup():
    """Remove socket file."""
    try:
        SOCKET_PATH.unlink(missing_ok=True)
    except Exception:
        pass


def main():
    # Clean up stale socket file
    cleanup()

    server = ThreadedUnixServer(str(SOCKET_PATH), HookHandler)

    def shutdown_handler(signum, frame):
        print("Shutting down daemon...", file=sys.stderr)
        server.shutdown()
        cleanup()
        global _db_conn
        if _db_conn:
            try:
                _db_conn.close()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    print(f"Monitor daemon listening on {SOCKET_PATH}", file=sys.stderr)
    sys.stderr.flush()

    try:
        server.serve_forever()
    finally:
        cleanup()


if __name__ == "__main__":
    main()
