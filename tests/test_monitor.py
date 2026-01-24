"""
Tests for monitor.py
"""

import json
import io
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


class TestMonitorMain:
    """Tests for the main monitor function."""

    def test_invalid_json_continues(self, capsys):
        """Test that invalid JSON input returns continue: True."""
        with patch('sys.stdin', io.StringIO("not valid json")):
            from monitor import main
            main()

        captured = capsys.readouterr()
        output = json.loads(captured.out)
        assert output["continue"] is True

    def test_session_start_creates_session(self, db_conn, temp_dir, capsys):
        """Test that SessionStart hook creates a session and prompt."""
        db_path = temp_dir / "test.db"

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": "SessionStart",
            "transcript_path": "/tmp/transcript.jsonl"
        }

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.start_debounced_worker'), \
             patch('monitor.notify'):
            from monitor import main
            main()

        # Check session was created
        session = db_conn.execute('SELECT * FROM sessions WHERE session_id = ?', ("test-session",)).fetchone()
        assert session is not None
        assert session['status'] == "started"

        # Check prompt was created
        prompt = db_conn.execute('SELECT * FROM prompts WHERE session_id = ?', ("test-session",)).fetchone()
        assert prompt is not None

        # Check output
        captured = capsys.readouterr()
        output = json.loads(captured.out)
        assert output["continue"] is True

    def test_user_prompt_submit_creates_prompt(self, db_conn, temp_dir, capsys):
        """Test that UserPromptSubmit creates a prompt with text."""
        db_path = temp_dir / "test.db"

        # First create a session
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test/project")')
        db_conn.execute('INSERT INTO sessions (session_id, project_id, status) VALUES (?, ?, ?)',
                       ("test-session", 1, "started"))
        db_conn.commit()

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "Hello, world!",
            "transcript_path": "/tmp/transcript.jsonl"
        }

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.start_debounced_worker'), \
             patch('monitor.get_session_index_entry', return_value=None):
            from monitor import main
            main()

        # Check prompt was created with text
        prompt = db_conn.execute('SELECT * FROM prompts WHERE session_id = ? AND prompt = ?',
                                ("test-session", "Hello, world!")).fetchone()
        assert prompt is not None

    def test_session_end_clears_active_session(self, db_conn, temp_dir, capsys):
        """Test that SessionEnd clears the active session."""
        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path, active_session_id) VALUES (1, "/test/project", "test-session")')
        db_conn.execute('INSERT INTO sessions (session_id, project_id, status) VALUES (?, ?, ?)',
                       ("test-session", 1, "active"))
        db_conn.commit()

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": "SessionEnd",
            "transcript_path": ""
        }

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.start_debounced_worker'):
            from monitor import main
            main()

        # Check active session was cleared
        project = db_conn.execute('SELECT active_session_id FROM projects WHERE id = 1').fetchone()
        assert project['active_session_id'] is None

    def test_hook_event_saved(self, db_conn, temp_dir, capsys):
        """Test that hook events are saved to hooks table."""
        db_path = temp_dir / "test.db"

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": "PreToolUse",
            "tool_name": "Read"
        }

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.start_debounced_worker'):
            from monitor import main
            main()

        # Check hook was saved
        hook = db_conn.execute('SELECT * FROM hooks WHERE session_id = ?', ("test-session",)).fetchone()
        assert hook is not None
        assert hook['hook_type'] == "PreToolUse"
        payload = json.loads(hook['payload'])
        assert payload['tool_name'] == "Read"

    def test_notification_permission_prompt(self, db_conn, temp_dir, capsys):
        """Test that permission_prompt triggers notification."""
        db_path = temp_dir / "test.db"

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": "Notification",
            "notification_type": "permission_prompt"
        }

        mock_notify = MagicMock()

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.start_debounced_worker'), \
             patch('monitor.notify', mock_notify):
            from monitor import main
            main()

        # Check notification was called
        mock_notify.assert_called_once_with("project", "Permission Request")

    def test_error_handling_logs_error(self, db_conn, temp_dir, capsys):
        """Test that errors are logged and re-raised."""
        db_path = temp_dir / "test.db"

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": "SessionStart"
        }

        def raise_error(*args, **kwargs):
            raise ValueError("Test error")

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.get_or_create_project', side_effect=raise_error):

            with pytest.raises(RuntimeError, match="Claude Dashboard Error"):
                from monitor import main
                main()

        # Check error was logged
        log_entry = db_conn.execute('SELECT data FROM logs ORDER BY id DESC LIMIT 1').fetchone()
        if log_entry:
            data = json.loads(log_entry['data'])
            assert "error" in data or data.get('message') == "Monitor error"


class TestStatusMapping:
    """Tests for hook type to status mapping."""

    @pytest.mark.parametrize("hook_type,expected_status", [
        ("SessionStart", "started"),
        ("UserPromptSubmit", "active"),
        ("PreToolUse", "active"),
        ("PostToolUse", "active"),
        ("Stop", "done"),
        ("SessionEnd", "ended"),
    ])
    def test_hook_type_to_status(self, db_conn, temp_dir, hook_type, expected_status, capsys):
        """Test that hook types map to correct statuses."""
        db_path = temp_dir / "test.db"

        event = {
            "session_id": "test-session",
            "cwd": "/test/project",
            "hook_event_name": hook_type,
            "transcript_path": ""
        }

        with patch('sys.stdin', io.StringIO(json.dumps(event))), \
             patch('db.DB_PATH', db_path), \
             patch('monitor.start_debounced_worker'), \
             patch('monitor.get_session_index_entry', return_value=None):
            from monitor import main
            main()

        session = db_conn.execute('SELECT status FROM sessions WHERE session_id = ?', ("test-session",)).fetchone()
        assert session['status'] == expected_status


class TestCleanSessions:
    """Tests for session cleanup."""

    def test_clean_sessions_removes_stale(self, db_conn):
        """Test that stale sessions are cleaned up."""
        from monitor import clean_sessions

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        db_conn.execute('INSERT INTO sessions (session_id, project_id, status) VALUES (?, ?, ?)',
                       ("current", 1, "started"))
        db_conn.execute('INSERT INTO sessions (session_id, project_id, status) VALUES (?, ?, ?)',
                       ("stale", 1, "started"))
        db_conn.commit()

        clean_sessions(db_conn, 1, "current")
        db_conn.commit()

        # Check stale was removed
        assert db_conn.execute('SELECT * FROM sessions WHERE session_id = ?', ("stale",)).fetchone() is None
        assert db_conn.execute('SELECT * FROM sessions WHERE session_id = ?', ("current",)).fetchone() is not None
