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
             patch('monitor.upsert_project', side_effect=raise_error):

            with pytest.raises(RuntimeError, match="WorkIO Error"):
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


class TestProjectPathStability:
    """Tests for project path stability when cwd changes during a session.

    When Claude Code changes working directory during a session (e.g., from
    /Users/apo/code/workio to /Users/apo/code/workio/app),
    the session's project_path should remain stable at the original path.
    """

    def test_cwd_change_does_not_create_new_project_for_session(self, db_conn, temp_dir):
        """Test that changing cwd doesn't change the session's project.

        Scenario:
        1. SessionStart with cwd=/Users/apo/code/workio
        2. UserPromptSubmit with cwd=/Users/apo/code/workio/app

        Expected:
        - Session's project_id stays the same (original project)
        - No new project association for this session
        """
        from db import upsert_project, upsert_session, get_session_project_path

        original_path = "/Users/apo/code/workio"
        subdir_path = "/Users/apo/code/workio/app"

        # Create two projects with different paths
        original_project_id = upsert_project(db_conn, original_path)
        subdir_project_id = upsert_project(db_conn, subdir_path)
        db_conn.commit()

        # Verify they are different projects
        assert original_project_id != subdir_project_id

        # First hook: session created with original path
        upsert_session(db_conn, "test-session", original_project_id, "started", "/transcript.jsonl")
        db_conn.commit()

        # Verify session has original project_id
        session = db_conn.execute('SELECT project_id FROM sessions WHERE session_id = ?',
                                 ("test-session",)).fetchone()
        assert session['project_id'] == original_project_id

        # Second hook: same session but with subdirectory project_id (simulating cwd change)
        upsert_session(db_conn, "test-session", subdir_project_id, "active", "/transcript.jsonl")
        db_conn.commit()

        # Verify project_id was NOT updated - should still be original
        session = db_conn.execute('SELECT project_id FROM sessions WHERE session_id = ?',
                                 ("test-session",)).fetchone()
        assert session['project_id'] == original_project_id, \
            f"Session project_id should remain {original_project_id}, but got {session['project_id']}"

        # Verify get_session_project_path returns the original path
        stored_path = get_session_project_path(db_conn, "test-session")
        assert stored_path == original_path, \
            f"Stored project path should be '{original_path}', but got '{stored_path}'"

    def test_session_index_lookup_uses_stored_path(self, db_conn, temp_dir):
        """Test that session index lookup uses the stored project path, not current cwd.

        When Claude changes cwd, the session index file is still at the original
        project path. We should use the stored path, not the current cwd.
        """
        from db import upsert_project, upsert_session, get_session_project_path
        from monitor import get_session_index_entry

        original_path = "/test/original/project"
        subdir_path = "/test/original/project/subdir"

        # Create a mock sessions-index.json at the original path location
        claude_dir = temp_dir / ".claude" / "projects" / original_path.replace('/', '-')
        claude_dir.mkdir(parents=True)
        index_file = claude_dir / "sessions-index.json"
        index_file.write_text(json.dumps({
            "entries": [
                {
                    "sessionId": "test-session",
                    "customTitle": "Test Session Title",
                    "gitBranch": "main",
                    "messageCount": 5
                }
            ]
        }))

        # Verify index can be found with original path
        with patch.object(Path, 'home', return_value=temp_dir):
            entry = get_session_index_entry(original_path, "test-session")
            assert entry is not None
            assert entry['customTitle'] == "Test Session Title"

            # Verify index CANNOT be found with subdir path (no index there)
            entry_subdir = get_session_index_entry(subdir_path, "test-session")
            assert entry_subdir is None, "Index should not be found at subdir path"

        # Setup session with original path
        project_id = upsert_project(db_conn, original_path)
        upsert_session(db_conn, "test-session", project_id, "started", "")
        db_conn.commit()

        # Verify stored path is the original
        stored_path = get_session_project_path(db_conn, "test-session")
        assert stored_path == original_path

        # When cwd changes to subdir, we should use stored_path for index lookup
        # This simulates what monitor.py now does
        current_cwd = subdir_path  # Claude changed cwd
        lookup_path = stored_path or current_cwd  # Use stored path if available

        with patch.object(Path, 'home', return_value=temp_dir):
            entry = get_session_index_entry(lookup_path, "test-session")
            assert entry is not None, \
                "Should find index using stored path even when cwd changed"
            assert entry['customTitle'] == "Test Session Title"
