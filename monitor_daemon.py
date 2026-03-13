#!/usr/bin/env python3
"""
Persistent monitor daemon for Claude Code hook events.

Listens on a Unix socket, holds a single DB connection, and processes
hook events forwarded by the thin-client monitor.py.
Started by the Node.js server on startup.
"""

import hashlib
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
    create_prompt,
    get_ignore_external_sessions
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


def resolve_project_path(transcript_path: str) -> str:
    """Resolve the real project path from a transcript path.

    Uses ~/.claude.json projects keys to find the real path that matches
    the encoded directory name, avoiding the lossy dash-to-slash conversion.
    """
    if not transcript_path:
        return ''
    encoded_dir = Path(transcript_path).parent.name  # e.g., '-Users-apo-code-trashlab-autumn-lily'
    claude_json = Path.home() / '.claude.json'
    try:
        with open(claude_json) as f:
            data = json.load(f)
        for real_path in data.get('projects', {}):
            if real_path.replace('/', '-') == encoded_dir:
                return real_path
    except (json.JSONDecodeError, IOError, OSError):
        pass
    return ''


def read_last_assistant_message(transcript_path: str, max_bytes: int = 8192) -> str | None:
    """Read the last assistant text message from a transcript JSONL file.

    Reads the tail of the file to avoid loading the entire transcript.
    Returns the text content truncated to 200 chars, or None if not found.
    """
    try:
        path = Path(transcript_path)
        if not path.exists():
            return None
        file_size = path.stat().st_size
        with open(path, 'rb') as f:
            f.seek(max(0, file_size - max_bytes))
            tail = f.read().decode('utf-8', errors='replace')
        # Parse lines in reverse to find the last assistant message
        for line in reversed(tail.strip().splitlines()):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get('type') != 'assistant':
                continue
            content = entry.get('message', {}).get('content', [])
            for block in content:
                if block.get('type') == 'text' and block.get('text', '').strip():
                    text = block['text'].strip()
                    return text[:200]
    except (OSError, IOError):
        pass
    return None


def process_event(event: dict, env: dict, host: str = 'local', session_index: dict | None = None) -> dict:
    """Process a single hook event. Returns the response dict."""
    is_remote = host != 'local'

    with _db_lock:
        conn = get_conn()
        try:
            session_id = event.get('session_id', 'unknown')
            transcript_path = event.get('transcript_path', '')
            hook_type = event.get('hook_event_name', '')
            terminal_id_str = env.get('WORKIO_TERMINAL_ID')
            terminal_id = int(terminal_id_str) if terminal_id_str else None
            shell_id_str = env.get('WORKIO_SHELL_ID')
            shell_id = int(shell_id_str) if shell_id_str else None

            # Remote hooks: cwd is already resolved by the forwarder
            # Local hooks: resolve from transcript path
            if is_remote:
                project_path = event.get('cwd', '')
            else:
                project_path = resolve_project_path(transcript_path) or event.get('cwd', '')

            if terminal_id is None and shell_id is None:
                if get_ignore_external_sessions(conn):
                    return {"continue": True}

            log(conn, "Received hook event", hook_type=hook_type, session_id=session_id, payload=event, terminal_id=terminal_id_str, host=host)

            # Compute dedupe_key for remote hooks
            dedupe_key = None
            if is_remote:
                timestamp = event.get('timestamp', '')
                dedupe_key = hashlib.sha256(f"{session_id}:{hook_type}:{timestamp}".encode()).hexdigest()[:64]

            inserted = save_hook(conn, session_id, hook_type, event, dedupe_key)
            if not inserted:
                # Duplicate remote hook — ACK without processing
                conn.commit()
                return {"continue": True}

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

            project_id = upsert_project(conn, project_path, host)

            if status:
                upsert_session(conn, session_id, project_id, status, transcript_path, terminal_id, shell_id)

            if hook_type == 'SessionStart':
                clean_sessions(conn, project_id, session_id)
                # Only create an initial empty prompt for new sessions, not resumes
                if event.get('source') != 'resume':
                    create_prompt(conn, session_id)
                    log(conn, "Created prompt", session_id=session_id)

            if hook_type in ('SessionStart', 'UserPromptSubmit'):
                # Remote hooks: use session_index from forwarder payload
                if is_remote and session_index:
                    name = session_index.get('customTitle') or session_index.get('firstPrompt') or session_index.get('name')
                    message_count = session_index.get('messageCount')
                    if name or message_count:
                        update_session_metadata(conn, session_id, name, message_count)
                else:
                    stored_path = get_session_project_path(conn, session_id) or project_path
                    update_session_from_index(conn, stored_path, session_id)

            if hook_type == 'UserPromptSubmit':
                prompt_text = event.get('prompt', '')
                create_prompt(conn, session_id, prompt_text)
                update_session_name_if_empty(conn, session_id, prompt_text)
                log(conn, "Created prompt", session_id=session_id, prompt_length=len(prompt_text))

            # Extract last assistant message for Stop notifications
            last_message = None
            if hook_type == 'Stop':
                if is_remote:
                    # Remote: use event field (transcript mirror may not have it yet)
                    last_message = event.get('last_assistant_message')
                elif transcript_path:
                    last_message = read_last_assistant_message(transcript_path)

            notify(conn, "hook", {
                "session_id": session_id,
                "hook_type": hook_type,
                "status": status,
                "project_path": project_path,
                "terminal_id": terminal_id,
                "shell_id": shell_id,
                **({"last_message": last_message} if last_message else {}),
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
            host = message.get('host', 'local')
            session_index = message.get('session_index')

            response = process_event(event, env, host, session_index)
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
