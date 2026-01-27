#!/usr/bin/env python3
"""
Async worker for emitting Socket.IO events via the Node server.
Events are processed synchronously per session_id using file locks.
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from db import (
    init_db, log
)
import requests
from dotenv import load_dotenv

# Load environment variables
for env_file in [".env", ".env.local"]:
    load_dotenv(Path(__file__).parent / env_file, override=True)

SOCKET_DIR = Path(__file__).parent / "socket_queue"
SERVER_PORT = os.environ.get("SERVER_PORT", "5176")
EMIT_URL = f"http://localhost:{SERVER_PORT}/api/emit"
LOCK_TIMEOUT = 30  # seconds


def emit_event(event: str, data: dict) -> bool:
    """Send event to Node server for Socket.IO broadcast."""
    try:
        response = requests.post(
            EMIT_URL,
            json={"event": event, "data": data},
            timeout=5
        )
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"[socket_worker] Failed to emit: {e}", file=sys.stderr)
        return False


def process_emit(session_id: str, event: str, data_json: str) -> None:
    """Process a socket emit job with session locking."""
    SOCKET_DIR.mkdir(exist_ok=True)

    lock_file = SOCKET_DIR / f"{session_id}.lock"

    # Wait for lock
    while lock_file.exists():
        try:
            lock_time = datetime.fromisoformat(lock_file.read_text().strip())
            lock_age = (datetime.now() - lock_time).total_seconds()
            if lock_age >= LOCK_TIMEOUT:
                lock_file.unlink()
                break
            time.sleep(0.1)
        except (ValueError, FileNotFoundError):
            break

    # Acquire lock
    lock_file.write_text(datetime.now().isoformat())

    conn = init_db()
    try:
        data = json.loads(data_json)
        emit_event(event, data)
    finally:
        log(conn, "Emitted event", event=event, data=data)
        conn.commit()
        conn.close()
        # Release lock
        try:
            lock_file.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: socket_worker.py <session_id> <event> <data_json>", file=sys.stderr)
        sys.exit(1)

    session_id = sys.argv[1]
    event = sys.argv[2]
    data_json = sys.argv[3]
    process_emit(session_id, event, data_json)
