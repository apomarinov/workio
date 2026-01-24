"""
Tests for database functions in db.py
"""

import json
import pytest
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import (
    log, save_hook,
    get_or_create_project, set_project_active_session,
    upsert_session, update_session_metadata, get_session,
    get_stale_session_ids, delete_sessions_cascade,
    create_prompt, get_latest_prompt, update_prompt_text,
    message_exists, create_message, get_latest_user_message
)


class TestLogs:
    """Tests for logging functions."""

    def test_log_creates_entry(self, db_conn):
        """Test that log creates a log entry."""
        log(db_conn, "Test message", key="value")
        db_conn.commit()

        row = db_conn.execute('SELECT data FROM logs').fetchone()
        data = json.loads(row['data'])

        assert data['message'] == "Test message"
        assert data['key'] == "value"

    def test_log_multiple_kwargs(self, db_conn):
        """Test log with multiple kwargs."""
        log(db_conn, "Test", a=1, b="two", c=True)
        db_conn.commit()

        row = db_conn.execute('SELECT data FROM logs').fetchone()
        data = json.loads(row['data'])

        assert data['a'] == 1
        assert data['b'] == "two"
        assert data['c'] is True


class TestHooks:
    """Tests for hook functions."""

    def test_save_hook(self, db_conn):
        """Test saving a hook event."""
        payload = {"event": "test", "data": 123}
        save_hook(db_conn, "session-1", "TestHook", payload)

        row = db_conn.execute('SELECT * FROM hooks').fetchone()

        assert row['session_id'] == "session-1"
        assert row['hook_type'] == "TestHook"
        assert json.loads(row['payload']) == payload


class TestProjects:
    """Tests for project functions."""

    def test_get_or_create_project_creates_new(self, db_conn):
        """Test creating a new project."""
        project_id = get_or_create_project(db_conn, "/test/path")

        assert project_id == 1

        row = db_conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        assert row['path'] == "/test/path"

    def test_get_or_create_project_returns_existing(self, db_conn):
        """Test that it returns existing project ID."""
        id1 = get_or_create_project(db_conn, "/test/path")
        id2 = get_or_create_project(db_conn, "/test/path")

        assert id1 == id2

    def test_get_or_create_project_different_paths(self, db_conn):
        """Test that different paths get different IDs."""
        id1 = get_or_create_project(db_conn, "/path/one")
        id2 = get_or_create_project(db_conn, "/path/two")

        assert id1 != id2

    def test_set_project_active_session(self, db_conn):
        """Test setting active session for a project."""
        project_id = get_or_create_project(db_conn, "/test/path")
        set_project_active_session(db_conn, project_id, "session-123")
        db_conn.commit()

        row = db_conn.execute('SELECT active_session_id FROM projects WHERE id = ?', (project_id,)).fetchone()
        assert row['active_session_id'] == "session-123"

    def test_set_project_active_session_to_none(self, db_conn):
        """Test clearing active session."""
        project_id = get_or_create_project(db_conn, "/test/path")
        set_project_active_session(db_conn, project_id, "session-123")
        set_project_active_session(db_conn, project_id, None)
        db_conn.commit()

        row = db_conn.execute('SELECT active_session_id FROM projects WHERE id = ?', (project_id,)).fetchone()
        assert row['active_session_id'] is None


class TestSessions:
    """Tests for session functions."""

    def test_upsert_session_creates_new(self, db_conn):
        """Test creating a new session."""
        upsert_session(db_conn, "session-1", 1, "started", "/transcript.jsonl")
        db_conn.commit()

        row = db_conn.execute('SELECT * FROM sessions WHERE session_id = ?', ("session-1",)).fetchone()
        assert row['project_id'] == 1
        assert row['status'] == "started"
        assert row['transcript_path'] == "/transcript.jsonl"

    def test_upsert_session_updates_existing(self, db_conn):
        """Test updating an existing session."""
        upsert_session(db_conn, "session-1", 1, "started", "/old.jsonl")
        upsert_session(db_conn, "session-1", 1, "active", "/new.jsonl")
        db_conn.commit()

        row = db_conn.execute('SELECT * FROM sessions WHERE session_id = ?', ("session-1",)).fetchone()
        assert row['status'] == "active"
        assert row['transcript_path'] == "/new.jsonl"

    def test_update_session_metadata(self, db_conn):
        """Test updating session metadata."""
        upsert_session(db_conn, "session-1", 1, "started", "")
        update_session_metadata(db_conn, "session-1", "My Session", "main", 10)
        db_conn.commit()

        row = db_conn.execute('SELECT * FROM sessions WHERE session_id = ?', ("session-1",)).fetchone()
        assert row['name'] == "My Session"
        assert row['git_branch'] == "main"
        assert row['message_count'] == 10

    def test_update_session_metadata_truncates_long_name(self, db_conn):
        """Test that long names are truncated to 200 chars."""
        upsert_session(db_conn, "session-1", 1, "started", "")
        long_name = "x" * 300
        update_session_metadata(db_conn, "session-1", long_name, None, None)
        db_conn.commit()

        row = db_conn.execute('SELECT name FROM sessions WHERE session_id = ?', ("session-1",)).fetchone()
        assert len(row['name']) == 200

    def test_get_session(self, db_conn):
        """Test getting a session by ID."""
        upsert_session(db_conn, "session-1", 1, "active", "/transcript.jsonl")
        db_conn.commit()

        session = get_session(db_conn, "session-1")
        assert session is not None
        assert session['status'] == "active"

    def test_get_session_not_found(self, db_conn):
        """Test getting a non-existent session."""
        session = get_session(db_conn, "nonexistent")
        assert session is None

    def test_get_stale_session_ids(self, db_conn):
        """Test getting stale session IDs."""
        # Create project and sessions
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "current", 1, "started", "")
        upsert_session(db_conn, "stale-1", 1, "started", "")
        upsert_session(db_conn, "stale-2", 1, "started", "")
        upsert_session(db_conn, "active", 1, "active", "")  # Not stale - different status
        db_conn.commit()

        stale_ids = get_stale_session_ids(db_conn, 1, "current")

        assert "stale-1" in stale_ids
        assert "stale-2" in stale_ids
        assert "current" not in stale_ids
        assert "active" not in stale_ids

    def test_delete_sessions_cascade(self, db_conn):
        """Test cascading delete of sessions."""
        # Setup data
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "session-1", 1, "started", "")
        upsert_session(db_conn, "session-2", 1, "started", "")

        prompt_id = create_prompt(db_conn, "session-1", "test prompt")
        create_message(db_conn, prompt_id, "msg-1", "2024-01-01", "Hello", False, True)
        save_hook(db_conn, "session-1", "TestHook", {})
        db_conn.commit()

        # Delete session-1
        delete_sessions_cascade(db_conn, ["session-1"])
        db_conn.commit()

        # Verify cascade
        assert get_session(db_conn, "session-1") is None
        assert get_session(db_conn, "session-2") is not None
        assert db_conn.execute('SELECT COUNT(*) FROM prompts WHERE session_id = ?', ("session-1",)).fetchone()[0] == 0
        assert db_conn.execute('SELECT COUNT(*) FROM messages WHERE prompt_id = ?', (prompt_id,)).fetchone()[0] == 0
        assert db_conn.execute('SELECT COUNT(*) FROM hooks WHERE session_id = ?', ("session-1",)).fetchone()[0] == 0

    def test_delete_sessions_cascade_empty_list(self, db_conn):
        """Test that empty list doesn't cause errors."""
        delete_sessions_cascade(db_conn, [])  # Should not raise


class TestPrompts:
    """Tests for prompt functions."""

    def test_create_prompt_with_text(self, db_conn):
        """Test creating a prompt with text."""
        prompt_id = create_prompt(db_conn, "session-1", "Hello world")

        row = db_conn.execute('SELECT * FROM prompts WHERE id = ?', (prompt_id,)).fetchone()
        assert row['session_id'] == "session-1"
        assert row['prompt'] == "Hello world"

    def test_create_prompt_without_text(self, db_conn):
        """Test creating a prompt without text."""
        prompt_id = create_prompt(db_conn, "session-1")

        row = db_conn.execute('SELECT * FROM prompts WHERE id = ?', (prompt_id,)).fetchone()
        assert row['prompt'] is None

    def test_get_latest_prompt(self, db_conn):
        """Test getting the latest prompt."""
        create_prompt(db_conn, "session-1", "First")
        create_prompt(db_conn, "session-1", "Second")
        create_prompt(db_conn, "session-1", "Third")

        latest = get_latest_prompt(db_conn, "session-1")
        assert latest['prompt'] == "Third"

    def test_get_latest_prompt_no_prompts(self, db_conn):
        """Test getting latest prompt when none exist."""
        latest = get_latest_prompt(db_conn, "nonexistent")
        assert latest is None

    def test_update_prompt_text(self, db_conn):
        """Test updating prompt text."""
        prompt_id = create_prompt(db_conn, "session-1")
        update_prompt_text(db_conn, prompt_id, "Updated text")
        db_conn.commit()

        row = db_conn.execute('SELECT prompt FROM prompts WHERE id = ?', (prompt_id,)).fetchone()
        assert row['prompt'] == "Updated text"


class TestMessages:
    """Tests for message functions."""

    def test_message_exists_true(self, db_conn):
        """Test message_exists returns True for existing message."""
        prompt_id = create_prompt(db_conn, "session-1")
        create_message(db_conn, prompt_id, "uuid-123", "2024-01-01", "Hello", False, True)

        assert message_exists(db_conn, "uuid-123") is True

    def test_message_exists_false(self, db_conn):
        """Test message_exists returns False for non-existing message."""
        assert message_exists(db_conn, "nonexistent") is False

    def test_create_message_user(self, db_conn):
        """Test creating a user message."""
        prompt_id = create_prompt(db_conn, "session-1")
        msg_id = create_message(db_conn, prompt_id, "uuid-1", "2024-01-01T10:00:00", "Hello", False, True)

        row = db_conn.execute('SELECT * FROM messages WHERE id = ?', (msg_id,)).fetchone()
        assert row['body'] == "Hello"
        assert row['is_user'] == 1
        assert row['thinking'] == 0

    def test_create_message_assistant_thinking(self, db_conn):
        """Test creating an assistant thinking message."""
        prompt_id = create_prompt(db_conn, "session-1")
        msg_id = create_message(db_conn, prompt_id, "uuid-1", "2024-01-01", "Thinking...", True, False)

        row = db_conn.execute('SELECT * FROM messages WHERE id = ?', (msg_id,)).fetchone()
        assert row['thinking'] == 1
        assert row['is_user'] == 0

    def test_get_latest_user_message(self, db_conn):
        """Test getting the latest user message."""
        prompt_id = create_prompt(db_conn, "session-1")
        create_message(db_conn, prompt_id, "uuid-1", "2024-01-01", "First user msg", False, True)
        create_message(db_conn, prompt_id, "uuid-2", "2024-01-01", "Assistant reply", False, False)
        create_message(db_conn, prompt_id, "uuid-3", "2024-01-01", "Second user msg", False, True)

        latest = get_latest_user_message(db_conn, prompt_id)
        assert latest['body'] == "Second user msg"

    def test_get_latest_user_message_no_user_messages(self, db_conn):
        """Test getting latest user message when none exist."""
        prompt_id = create_prompt(db_conn, "session-1")
        create_message(db_conn, prompt_id, "uuid-1", "2024-01-01", "Assistant only", False, False)

        latest = get_latest_user_message(db_conn, prompt_id)
        assert latest is None
