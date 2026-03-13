#!/usr/bin/env python3
"""
Remote Claude Hook Forwarder for WorkIO.

Receives hook events on stdin (same as monitor.py), enriches them with
remote-only context (project path, session index, host alias), queues to a
durable file queue, and flushes to the local WorkIO server via SSH tunnel.

Transcript delta is NOT read inline (Claude hasn't flushed the transcript
yet when the hook fires). Instead, a detached child process waits ~1s for
Claude to finish writing, then reads the delta and sends it separately —
mirroring how the local pipeline works (worker.py reads the transcript
after a debounce delay).

Stdlib-only — no external dependencies.
"""

import json
import os
import ssl
import sys
import time
import uuid
from datetime import datetime, timezone
from http.client import HTTPConnection, HTTPSConnection
from pathlib import Path

WORKIO_DIR = Path.home() / '.workio'
QUEUE_DIR = WORKIO_DIR / 'claude_queue'
OFFSETS_DIR = WORKIO_DIR / 'offsets'
CONFIG_PATH = WORKIO_DIR / 'config.json'
CLAUDE_JSON = Path.home() / '.claude.json'

TUNNEL_HOST = '127.0.0.1'
TUNNEL_PORT = 18765
QUEUE_MAX_BYTES = 200 * 1024 * 1024  # 200MB cap
TRANSCRIPT_DELAY = 1.0  # seconds to wait for Claude to flush transcript


def read_config() -> dict:
    """Read ~/.workio/config.json for host_alias."""
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except (IOError, json.JSONDecodeError):
        return {}


def resolve_project_path(transcript_path: str) -> str:
    """Resolve the real project path from a transcript path.

    Uses ~/.claude.json projects keys to find the real path that matches
    the encoded directory name, avoiding the lossy dash-to-slash conversion.
    """
    if not transcript_path:
        return ''
    encoded_dir = Path(transcript_path).parent.name
    try:
        with open(CLAUDE_JSON) as f:
            data = json.load(f)
        for real_path in data.get('projects', {}):
            if real_path.replace('/', '-') == encoded_dir:
                return real_path
    except (IOError, json.JSONDecodeError, OSError):
        pass
    return ''


def read_transcript_delta(transcript_path: str, session_id: str) -> tuple[str, int]:
    """Read new JSONL lines from transcript since last offset.

    Returns (delta_text, new_offset).
    """
    if not transcript_path or not os.path.exists(transcript_path):
        return '', 0

    OFFSETS_DIR.mkdir(parents=True, exist_ok=True)
    offset_file = OFFSETS_DIR / session_id

    last_offset = 0
    try:
        last_offset = int(offset_file.read_text().strip())
    except (IOError, ValueError):
        pass

    try:
        file_size = os.path.getsize(transcript_path)
        if file_size <= last_offset:
            return '', last_offset

        with open(transcript_path, 'rb') as f:
            f.seek(last_offset)
            delta = f.read()

        new_offset = last_offset + len(delta)
        offset_file.write_text(str(new_offset))
        return delta.decode('utf-8', errors='replace'), new_offset
    except (IOError, OSError):
        return '', last_offset


def get_session_index_entry(project_path: str, session_id: str) -> dict | None:
    """Get session entry from Claude's sessions-index.json."""
    if not project_path:
        return None
    encoded_path = project_path.replace('/', '-')
    index_path = Path.home() / '.claude' / 'projects' / encoded_path / 'sessions-index.json'

    try:
        with open(index_path) as f:
            data = json.load(f)
        for entry in data.get('entries', []):
            if entry.get('sessionId') == session_id:
                return entry
    except (IOError, json.JSONDecodeError):
        pass
    return None


def build_payload(event: dict) -> dict:
    """Build the hook payload with event metadata (no transcript delta)."""
    config = read_config()
    host_alias = config.get('host_alias', 'unknown')

    transcript_path = event.get('transcript_path', '')

    # Stamp the event so the server can dedupe retries from the queue
    event['timestamp'] = datetime.now(timezone.utc).isoformat()

    # Resolve project path
    project_path = resolve_project_path(transcript_path) or event.get('cwd', '')
    if project_path:
        event['cwd'] = project_path

    # Read session index entry
    session_index = get_session_index_entry(project_path, event.get('session_id', ''))

    return {
        'event': event,
        'env': {
            'WORKIO_TERMINAL_ID': os.environ.get('WORKIO_TERMINAL_ID', ''),
            'WORKIO_SHELL_ID': os.environ.get('WORKIO_SHELL_ID', ''),
        },
        'host_alias': host_alias,
        'transcript_delta': None,
        'transcript_offset': 0,
        'session_index': session_index,
    }


def build_transcript_payload(session_id: str, transcript_path: str) -> dict | None:
    """Build a transcript-only payload with the delta since last read."""
    delta, offset = read_transcript_delta(transcript_path, session_id)
    if not delta:
        return None

    config = read_config()
    host_alias = config.get('host_alias', 'unknown')
    project_path = resolve_project_path(transcript_path)

    return {
        'event': {
            'session_id': session_id,
            'hook_event_name': 'TranscriptSync',
            'transcript_path': transcript_path,
            'cwd': project_path,
        },
        'env': {
            'WORKIO_TERMINAL_ID': os.environ.get('WORKIO_TERMINAL_ID', ''),
            'WORKIO_SHELL_ID': os.environ.get('WORKIO_SHELL_ID', ''),
        },
        'host_alias': host_alias,
        'transcript_delta': delta,
        'transcript_offset': offset,
        'session_index': get_session_index_entry(project_path, session_id),
    }


def enqueue(payload: dict) -> Path:
    """Write enriched payload to the durable file queue.

    Returns the path of the queued file.
    """
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)

    # Enforce disk cap
    enforce_queue_cap()

    file_path = QUEUE_DIR / f'{uuid.uuid4()}.json'
    file_path.write_text(json.dumps(payload))
    return file_path


def enforce_queue_cap() -> None:
    """Drop oldest files if queue exceeds cap."""
    try:
        files = sorted(QUEUE_DIR.iterdir(), key=lambda f: f.stat().st_mtime)
        total_size = sum(f.stat().st_size for f in files)
        while total_size > QUEUE_MAX_BYTES and files:
            oldest = files.pop(0)
            total_size -= oldest.stat().st_size
            oldest.unlink(missing_ok=True)
    except OSError:
        pass


def _post_hook(payload: str) -> int:
    """POST payload to the local WorkIO server. Returns HTTP status code.

    Tries HTTPS first (server may have self-signed certs), falls back to HTTP.
    """
    headers = {'Content-Type': 'application/json'}

    # Try HTTPS first (self-signed cert — skip verification)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = HTTPSConnection(TUNNEL_HOST, TUNNEL_PORT, timeout=10, context=ctx)
        conn.request('POST', '/claude-hook', body=payload, headers=headers)
        resp = conn.getresponse()
        status = resp.status
        conn.close()
        return status
    except Exception:
        pass

    # Fall back to plain HTTP
    conn = HTTPConnection(TUNNEL_HOST, TUNNEL_PORT, timeout=10)
    conn.request('POST', '/claude-hook', body=payload, headers=headers)
    resp = conn.getresponse()
    status = resp.status
    conn.close()
    return status


def try_flush() -> None:
    """Send oldest queued files to local WorkIO server via tunnel.

    Deletes each file after successful HTTP 200. Stops on first error.
    """
    if not QUEUE_DIR.exists():
        return

    files = sorted(QUEUE_DIR.iterdir(), key=lambda f: f.stat().st_mtime)

    for file_path in files:
        try:
            payload = file_path.read_text()
        except (IOError, OSError):
            continue

        try:
            status = _post_hook(payload)
            if status == 200:
                file_path.unlink(missing_ok=True)
            else:
                # Server returned error — stop flushing
                break
        except (OSError, ConnectionError, TimeoutError):
            # Tunnel likely down — stop flushing
            break


def main() -> None:
    # Read hook event from stdin
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({'continue': True}))
        return

    session_id = event.get('session_id', '')
    transcript_path = event.get('transcript_path', '')

    # Send event immediately (no transcript delta — same as local monitor.py)
    payload = build_payload(event)
    enqueue(payload)
    try_flush()

    # Return response to Claude
    print(json.dumps({'continue': True}))
    sys.stdout.flush()

    # Fork a detached child to read+send transcript delta after Claude
    # flushes the transcript. This mirrors the local pipeline where
    # worker.py reads the transcript after a debounce delay.
    if session_id and transcript_path:
        try:
            pid = os.fork()
            if pid == 0:
                # Child: detach from parent's session and stdio
                try:
                    os.setsid()
                    devnull = os.open(os.devnull, os.O_RDWR)
                    os.dup2(devnull, 0)
                    os.dup2(devnull, 1)
                    os.dup2(devnull, 2)
                    os.close(devnull)

                    time.sleep(TRANSCRIPT_DELAY)

                    delta_payload = build_transcript_payload(session_id, transcript_path)
                    if delta_payload:
                        enqueue(delta_payload)
                        try_flush()
                except Exception:
                    pass
                os._exit(0)
        except OSError:
            pass  # fork not available — transcript syncs on next hook


if __name__ == '__main__':
    main()
