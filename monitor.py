#!/usr/bin/env python3
"""
Thin client for Claude Code hooks.

Forwards hook events to the monitor daemon via Unix socket.
If the daemon is not running, returns {"continue": true} immediately.
"""

import json
import os
import socket
import sys
from pathlib import Path

SOCKET_PATH = str(Path(__file__).parent / "daemon.sock")


def main() -> None:
    # Read hook event from stdin
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"continue": True}))
        return

    # Build message with event + relevant env vars
    message = json.dumps({
        "event": event,
        "env": {
            "WORKIO_TERMINAL_ID": os.environ.get("WORKIO_TERMINAL_ID", ""),
            "WORKIO_SHELL_ID": os.environ.get("WORKIO_SHELL_ID", ""),
        }
    })

    # Try to forward to daemon
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect(SOCKET_PATH)
        sock.sendall(message.encode() + b'\n')

        # Read response
        response = b''
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk
            if b'\n' in response:
                break

        sock.close()
        print(response.decode().strip())

    except (ConnectionRefusedError, FileNotFoundError, OSError):
        # Daemon not running — dashboard is down, nothing to do
        print(json.dumps({"continue": True}))


if __name__ == "__main__":
    main()
