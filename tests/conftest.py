"""
Shared test fixtures for WorkIO tests.
"""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def db_conn(temp_dir):
    """Create a fresh database connection using db module with temp path."""
    db_path = temp_dir / "test.db"

    # Patch DB_PATH before importing/using db module
    with patch("db.DB_PATH", db_path):
        from db import init_db
        conn = init_db()
        yield conn
        conn.close()


@pytest.fixture
def debounce_dir(temp_dir):
    """Create a temporary debounce directory."""
    debounce = temp_dir / "debounce"
    debounce.mkdir()
    yield debounce


@pytest.fixture
def sample_hook_event():
    """Sample hook event payload."""
    return {
        "session_id": "test-session-123",
        "cwd": "/test/project",
        "hook_event_name": "UserPromptSubmit",
        "prompt": "Hello, world!",
        "transcript_path": "/tmp/transcript.jsonl"
    }


@pytest.fixture
def sample_transcript(temp_dir):
    """Create a sample transcript file."""
    transcript_path = temp_dir / "transcript.jsonl"

    entries = [
        {
            "type": "user",
            "uuid": "user-msg-1",
            "timestamp": "2024-01-01T10:00:00",
            "message": {"role": "user", "content": "Hello, how are you?"}
        },
        {
            "type": "assistant",
            "uuid": "assistant-msg-1",
            "timestamp": "2024-01-01T10:00:01",
            "message": {
                "role": "assistant",
                "type": "message",
                "content": [{"type": "text", "text": "I'm doing well, thank you!"}]
            }
        },
        {
            "type": "assistant",
            "uuid": "assistant-msg-2",
            "timestamp": "2024-01-01T10:00:02",
            "message": {
                "role": "assistant",
                "type": "message",
                "content": [{"type": "thinking", "thinking": "Let me think about this..."}]
            }
        }
    ]

    with open(transcript_path, 'w') as f:
        for entry in entries:
            f.write(json.dumps(entry) + '\n')

    yield transcript_path
