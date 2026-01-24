"""
Tests for worker.py - debouncing, locking, and transcript processing.
"""

import json
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


class TestProcessTranscript:
    """Tests for transcript processing."""

    def test_process_transcript_creates_messages(self, db_conn, sample_transcript):
        """Test that transcript processing creates messages."""
        from worker import process_transcript
        from db import create_prompt

        # Setup
        prompt_id = create_prompt(db_conn, "test-session", "Test prompt")
        db_conn.commit()

        process_transcript(db_conn, "test-session", str(sample_transcript))
        db_conn.commit()

        # Check messages were created
        messages = db_conn.execute('SELECT * FROM messages WHERE prompt_id = ?', (prompt_id,)).fetchall()
        assert len(messages) == 3

        # Check user message
        user_msg = db_conn.execute('SELECT * FROM messages WHERE uuid = ?', ("user-msg-1",)).fetchone()
        assert user_msg['is_user'] == 1
        assert user_msg['body'] == "Hello, how are you?"

        # Check assistant text message
        assistant_msg = db_conn.execute('SELECT * FROM messages WHERE uuid = ?', ("assistant-msg-1",)).fetchone()
        assert assistant_msg['is_user'] == 0
        assert assistant_msg['thinking'] == 0

        # Check thinking message
        thinking_msg = db_conn.execute('SELECT * FROM messages WHERE uuid = ?', ("assistant-msg-2",)).fetchone()
        assert thinking_msg['thinking'] == 1

    def test_process_transcript_skips_existing(self, db_conn, sample_transcript):
        """Test that existing messages are not duplicated."""
        from worker import process_transcript
        from db import create_prompt, create_message

        prompt_id = create_prompt(db_conn, "test-session")
        # Pre-create one message
        create_message(db_conn, prompt_id, "user-msg-1", "2024-01-01", "Existing", False, True)
        db_conn.commit()

        process_transcript(db_conn, "test-session", str(sample_transcript))
        db_conn.commit()

        # Should only have 3 messages (1 existing + 2 new)
        count = db_conn.execute('SELECT COUNT(*) FROM messages WHERE prompt_id = ?', (prompt_id,)).fetchone()[0]
        assert count == 3

    def test_process_transcript_no_prompt(self, db_conn, sample_transcript):
        """Test handling when no prompt exists."""
        from worker import process_transcript

        # No prompt created - should log and return
        process_transcript(db_conn, "test-session", str(sample_transcript))
        db_conn.commit()

        # Check no messages created
        count = db_conn.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
        assert count == 0

    def test_process_transcript_missing_file(self, db_conn):
        """Test handling of missing transcript file."""
        from worker import process_transcript
        from db import create_prompt

        create_prompt(db_conn, "test-session")
        db_conn.commit()

        # Should not raise, just log
        process_transcript(db_conn, "test-session", "/nonexistent/file.jsonl")

    def test_process_transcript_sets_prompt_from_user_message(self, db_conn, sample_transcript):
        """Test that prompt text is set from user message if empty."""
        from worker import process_transcript
        from db import create_prompt, get_latest_prompt

        # Create prompt without text
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        process_transcript(db_conn, "test-session", str(sample_transcript))
        db_conn.commit()

        # Check prompt was updated
        prompt = get_latest_prompt(db_conn, "test-session")
        assert prompt['prompt'] == "Hello, how are you?"


class TestDebounce:
    """Tests for debounce logic."""

    def test_debounce_skips_non_latest(self, db_conn, debounce_dir, temp_dir):
        """Test that non-latest timestamps skip processing."""
        from worker import process_session

        db_path = temp_dir / "test.db"

        # Create marker with FUTURE start timestamp so debounce hasn't expired
        future_time = (datetime.now() + timedelta(hours=1)).isoformat()
        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": future_time,
            "latest": "different-timestamp"
        }))

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0), \
             patch('worker.time.sleep'):  # Skip the initial sleep
            process_session("test-session", "my-timestamp")

        # Check that processing was skipped (marker still exists)
        assert marker_file.exists()

    def test_debounce_processes_latest(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that latest timestamp processes the job."""
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": timestamp,
            "latest": timestamp
        }))

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0):
            from worker import process_session
            process_session("test-session", timestamp)

        # Check marker was cleaned up
        assert not marker_file.exists()

        # Check messages were processed
        count = db_conn.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
        assert count > 0


class TestLocking:
    """Tests for lock mechanism."""

    def test_lock_acquired_and_released(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that lock is acquired and released."""
        from worker import process_session
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        lock_file = debounce_dir / "test-session.lock"
        marker_file.write_text(json.dumps({
            "start": timestamp,
            "latest": timestamp
        }))

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0):
            process_session("test-session", timestamp)

        # Lock should be released
        assert not lock_file.exists()

    def test_lock_waits_for_existing(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that worker logs waiting for lock when lock exists."""
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        lock_file = debounce_dir / "test-session.lock"

        marker_file.write_text(json.dumps({
            "start": timestamp,
            "latest": timestamp
        }))

        # Create a lock file
        lock_file.write_text(datetime.now().isoformat())

        # Track lock wait loops
        lock_wait_count = [0]

        def mock_sleep(seconds):
            if seconds == 1:  # Lock wait interval (hardcoded in worker)
                lock_wait_count[0] += 1
                # Remove lock after first wait
                if lock_wait_count[0] >= 1 and lock_file.exists():
                    lock_file.unlink()
            # Don't actually sleep

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 2), \
             patch('worker.time.sleep', side_effect=mock_sleep):
            from worker import process_session
            process_session("test-session", timestamp)

        # Should have waited for lock at least once
        assert lock_wait_count[0] >= 1, f"Expected lock wait, got count: {lock_wait_count[0]}"

        # Check "Waiting for lock" was logged
        logs = db_conn.execute('SELECT data FROM logs').fetchall()
        log_messages = [json.loads(row['data']).get('message') for row in logs]
        assert "Waiting for lock" in log_messages

    def test_stale_lock_removed(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that stale locks are removed."""
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        lock_file = debounce_dir / "test-session.lock"

        marker_file.write_text(json.dumps({
            "start": timestamp,
            "latest": timestamp
        }))

        # Create a stale lock (very old)
        old_time = (datetime.now() - timedelta(hours=1)).isoformat()
        lock_file.write_text(old_time)

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 1):  # Lock timeout = 30 seconds
            from worker import process_session
            process_session("test-session", timestamp)

        # Should have processed (stale lock removed)
        assert not lock_file.exists()
        assert not marker_file.exists()

    def test_concurrent_workers_serialize(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that concurrent workers are serialized by lock."""
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup - use a fresh connection for each worker
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        timestamp1 = datetime.now().isoformat()
        timestamp2 = (datetime.now() + timedelta(milliseconds=100)).isoformat()

        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": timestamp1,
            "latest": timestamp2
        }))

        results = []

        def run_worker(ts):
            with patch('worker.DEBOUNCE_DIR', debounce_dir), \
                 patch('db.DB_PATH', db_path), \
                 patch('worker.DEBOUNCE_SECONDS', 0):
                from worker import process_session
                try:
                    process_session("test-session", ts)
                    results.append(("success", ts))
                except Exception as e:
                    results.append(("error", str(e)))

        # Start two workers
        t1 = threading.Thread(target=run_worker, args=(timestamp1,))
        t2 = threading.Thread(target=run_worker, args=(timestamp2,))

        t1.start()
        time.sleep(0.1)  # Give first worker time to acquire lock
        t2.start()

        t1.join()
        t2.join()

        # Both should complete (one processes, one skips due to marker gone)
        assert len(results) == 2

    def test_marker_preserved_when_new_event_during_processing(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that marker is NOT deleted if a new event arrived during processing."""
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        original_timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": original_timestamp,
            "latest": original_timestamp
        }))

        # We'll update the marker during processing to simulate a new event
        new_event_timestamp = (datetime.now() + timedelta(seconds=1)).isoformat()
        processing_started = [False]

        # Patch process_transcript to update marker mid-processing
        original_process_transcript = None

        def mock_process_transcript(conn, session_id, transcript_path):
            processing_started[0] = True
            # Simulate new event arriving during processing
            marker_file.write_text(json.dumps({
                "start": original_timestamp,
                "latest": new_event_timestamp
            }))
            # Call original
            original_process_transcript(conn, session_id, transcript_path)

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0):
            from worker import process_session, process_transcript
            original_process_transcript = process_transcript

            with patch('worker.process_transcript', side_effect=mock_process_transcript):
                process_session("test-session", original_timestamp)

        # Marker should still exist because a new event came in
        assert marker_file.exists(), "Marker should be preserved when new event arrives during processing"

        # Verify the marker has the new event's timestamp
        marker_data = json.loads(marker_file.read_text())
        assert marker_data['latest'] == new_event_timestamp

    def test_marker_deleted_when_no_new_events(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """Test that marker IS deleted when no new events arrived during processing."""
        from db import create_prompt, upsert_session

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": timestamp,
            "latest": timestamp
        }))

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0):
            from worker import process_session
            process_session("test-session", timestamp)

        # Marker should be deleted - no new events
        assert not marker_file.exists(), "Marker should be deleted when no new events"


class TestEndToEndDebounce:
    """End-to-end tests for the complete debounce flow."""

    def test_rapid_events_then_last_event_processes(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """
        Test the complete flow:
        1. Multiple rapid events come in
        2. First worker wakes up after debounce, processes
        3. New event arrives DURING processing
        4. Marker is preserved (not deleted)
        5. New event's worker wakes up and processes

        This ensures no events are lost even with the race condition.
        """
        from db import create_prompt, upsert_session
        from worker import process_transcript as real_process_transcript

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        # Simulate rapid events
        event1_ts = datetime.now().isoformat()
        event4_ts = (datetime.now() + timedelta(seconds=1)).isoformat()

        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": event1_ts,
            "latest": event1_ts
        }))

        results = []
        processing_count = [0]

        def mock_process_transcript(conn, session_id, transcript_path):
            processing_count[0] += 1

            # On first processing, simulate event 4 arriving mid-processing
            if processing_count[0] == 1:
                marker_file.write_text(json.dumps({
                    "start": event1_ts,
                    "latest": event4_ts
                }))

            # Call real function
            real_process_transcript(conn, session_id, transcript_path)

        # Run both workers with the mock active throughout
        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0), \
             patch('worker.process_transcript', side_effect=mock_process_transcript):
            from worker import process_session

            # Worker 1 processes, event4 arrives mid-processing
            process_session("test-session", event1_ts)
            results.append(("worker1", "completed"))

            # After worker1: marker should still exist with event4_ts
            assert marker_file.exists(), "Marker should exist after worker1 (event4 arrived during processing)"
            marker_data = json.loads(marker_file.read_text())
            assert marker_data['latest'] == event4_ts, "Marker should have event4's timestamp"

            # Worker 4 processes (the one spawned by event4)
            process_session("test-session", event4_ts)
            results.append(("worker4", "completed"))

        # After worker4: marker should be deleted (no new events)
        assert not marker_file.exists(), "Marker should be deleted after worker4 (no new events)"

        # Verify processing happened twice
        assert processing_count[0] == 2, f"Expected 2 processing runs, got {processing_count[0]}"

        # Verify both workers completed
        assert len(results) == 2

    def test_last_event_always_processes(self, db_conn, debounce_dir, sample_transcript, temp_dir):
        """
        Test that the absolute last event always gets processed,
        even if it arrives during another worker's processing.
        """
        from db import create_prompt, upsert_session
        from worker import process_transcript as real_process_transcript

        db_path = temp_dir / "test.db"

        # Setup
        db_conn.execute('INSERT INTO projects (id, path) VALUES (1, "/test")')
        upsert_session(db_conn, "test-session", 1, "active", str(sample_transcript))
        create_prompt(db_conn, "test-session")
        db_conn.commit()

        first_ts = datetime.now().isoformat()
        last_ts = (datetime.now() + timedelta(seconds=1)).isoformat()

        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": first_ts,
            "latest": first_ts
        }))

        processing_times = []

        def mock_process_transcript(conn, session_id, transcript_path):
            processing_times.append(datetime.now().isoformat())

            # On first call, simulate the "last event" arriving
            if len(processing_times) == 1:
                marker_file.write_text(json.dumps({
                    "start": first_ts,
                    "latest": last_ts
                }))

            real_process_transcript(conn, session_id, transcript_path)

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0), \
             patch('worker.process_transcript', side_effect=mock_process_transcript):
            from worker import process_session

            # First worker processes
            process_session("test-session", first_ts)

            # Marker should still exist for the last event
            assert marker_file.exists(), "Marker preserved for last event"

            # Last event's worker processes
            process_session("test-session", last_ts)

        # Marker should now be gone
        assert not marker_file.exists(), "Marker deleted after last event processed"

        # Both events were processed
        assert len(processing_times) == 2, "Both events should have been processed"


class TestErrorHandling:
    """Tests for error handling in worker."""

    def test_error_logged_and_raised(self, db_conn, debounce_dir, temp_dir):
        """Test that errors are logged and re-raised."""
        db_path = temp_dir / "test.db"

        timestamp = datetime.now().isoformat()
        marker_file = debounce_dir / "test-session.marker"
        marker_file.write_text(json.dumps({
            "start": timestamp,
            "latest": timestamp
        }))

        def raise_error(*args):
            raise ValueError("Test error")

        with patch('worker.DEBOUNCE_DIR', debounce_dir), \
             patch('db.DB_PATH', db_path), \
             patch('worker.DEBOUNCE_SECONDS', 0), \
             patch('worker.get_session', side_effect=raise_error):

            with pytest.raises(RuntimeError, match="Worker failed"):
                from worker import process_session
                process_session("test-session", timestamp)

        # Check error was logged
        log_entry = db_conn.execute('SELECT data FROM logs ORDER BY id DESC LIMIT 1').fetchone()
        assert log_entry is not None
        data = json.loads(log_entry['data'])
        assert data.get('message') == "Worker error"
        assert "Test error" in data.get('error', '')
