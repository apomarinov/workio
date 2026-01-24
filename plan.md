# Claude Code Multi-Session Monitor — Project Summary

## Original Intent

The user wants a **terminal-based dashboard** to monitor **multiple Claude Code instances** running across different projects simultaneously. The goal is to see all ongoing sessions at a glance — similar to a sidebar UI they showed in a screenshot — but with **real-time, AI-generated summaries** of what each session is doing.

---

## Conversation Flow

### 1. Initial Question
> "What's the best tool (desktop/web/UI/terminal) for managing multiple Claude Code instances and seeing them at a glance?"

I suggested several options:
- **Terminal multiplexers**: tmux, Zellij
- **Modern terminals**: Warp, iTerm2, Windows Terminal
- **IDE integration**: VS Code terminals
- **Dedicated tools**: Claude Squad, CCUsage

### 2. Clarification with Screenshot
User shared a screenshot of a sidebar UI showing:
- Projects grouped by folder
- Sessions listed under each project
- Session titles (first prompt)
- Timestamps ("4 hours ago", "2 days ago")
- Token counts (188, 61, 2279, etc.)
- Active/inactive indicators

They clarified: *"I want to see all ongoing sessions in every folder I have, in a sidebar, with summaries of where they're at."*

### 3. Exploring Claude Code's Data Structure
User asked: *"What is in `~/.claude/projects/` and how is it structured?"*

#### Answer: Claude Code Directory Structure

```
~/.claude/
├── projects/
│   └── <url-encoded-project-path>/
│       ├── <session-uuid>.jsonl          # Conversation history (NDJSON)
│       ├── <session-uuid>.summary        # Session title
│       └── subagents/
│           └── <subagent-uuid>.jsonl     # Sub-agent conversations
├── settings.json                          # Global settings
├── credentials.json                       # Auth tokens
└── statsig/                               # Analytics/feature flags
```

**JSONL Format** (each line is a message):
```jsonl
{"type":"human","message":"fix the login bug","timestamp":1234567890}
{"type":"assistant","message":"I'll look at...","timestamp":1234567891}
{"type":"tool_use","tool":"read_file","input":{"path":"src/auth.js"}}
{"type":"tool_result","output":"const login = ..."}
```

**Key fields**:
- `type`: human, assistant, tool_use, tool_result
- `message` / `content`: The actual text
- `timestamp`: Unix timestamp
- `tokenCount`: Tokens used for that message

### 4. First Tool Built: Basic TUI
I created a Python TUI using Textual that:
- Scans `~/.claude/projects/`
- Parses all JSONL files
- Displays projects in a tree view
- Shows session titles, timestamps, token counts
- Lets you view conversation history

### 5. User's Refined Requirements
User clarified they need something more sophisticated:

> **Per-project boxes showing:**
> 1. Summary of what the session is about (initial prompt)
> 2. Summary of last 2-3 user prompts (what they asked recently)
> 3. Summary of what Claude is doing *right now*
>
> **Additional features:**
> - Indicator when Claude is waiting for permissions
> - OS notification when Claude stops/needs attention
> - Near real-time updates (~5s delay acceptable)

User recognized that raw JSONL data isn't enough — they need **AI-generated summaries** from the conversation data.

### 6. Two Approaches Discussed

#### Approach A: File Watching + AI Summarization
```
~/.claude/projects/*.jsonl  →  File Watcher (inotify)  →  AI API  →  TUI
```
- **Pros**: Works without modifying Claude Code, works on old sessions
- **Cons**: Polling delay, hard to detect "waiting for permission" vs "thinking"

#### Approach B: Claude Code Hooks (Recommended)
```
Claude Code  →  Hooks  →  Your Script  →  Event Store  →  TUI
```
- **Pros**: Real-time events, knows exact state, no parsing guesswork
- **Cons**: Requires hook configuration

---

## Claude Code Hooks System (Deep Dive)

Documentation: https://code.claude.com/docs/en/hooks

Claude Code has a **hooks system** that fires events you can intercept. Configure in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": ["~/.claude/hooks/monitor.py"]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": ["~/.claude/hooks/monitor.py"]
      }
    ],
    "Notification": [
      {
        "matcher": "*",
        "hooks": ["~/.claude/hooks/monitor.py"]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": ["~/.claude/hooks/monitor.py"]
      }
    ]
  }
}
```

### Available Hook Events

| Event | When it fires | Data you get |
|-------|---------------|--------------|
| `PreToolUse` | Before any tool runs | Tool name, input params |
| `PostToolUse` | After tool completes | Tool name, output, success/fail |
| `Notification` | Claude wants to notify you | Message content |
| `Stop` | Session ends or pauses | Reason (complete, error, permission) |

### Hook Input (stdin)

```json
{
  "hook_type": "PostToolUse",
  "tool_name": "write_file",
  "tool_input": {"path": "src/app.py", "content": "..."},
  "tool_output": "File written successfully",
  "session_id": "abc-123",
  "project_path": "/home/user/myproject",
  "timestamp": 1234567890
}
```

### Hook Output (stdout)

```json
{"continue": true}   // Let Claude proceed
{"continue": false, "reason": "Blocked"}  // Stop Claude
```

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MONITORING SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │ Claude Code  │     │ Claude Code  │     │ Claude Code  │                │
│  │  Project A   │     │  Project B   │     │  Project C   │                │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘                │
│         │                    │                    │                         │
│         └────────────────────┼────────────────────┘                         │
│                              ▼                                              │
│                    ┌─────────────────┐                                      │
│                    │   Hook Script   │  ← Receives ALL events from all     │
│                    │   (Python)      │    Claude Code instances            │
│                    └────────┬────────┘                                      │
│                             │                                               │
│                             ▼                                               │
│                    ┌─────────────────┐                                      │
│                    │  Event Store    │  ← SQLite database                  │
│                    │  (SQLite)       │                                      │
│                    └────────┬────────┘                                      │
│                             │                                               │
│                             ▼                                               │
│                    ┌─────────────────┐                                      │
│                    │  AI Summarizer  │  ← Background daemon                │
│                    │  (Claude API)   │    Generates summaries on change    │
│                    └────────┬────────┘                                      │
│                             │                                               │
│              ┌──────────────┼──────────────┐                               │
│              ▼              ▼              ▼                               │
│     ┌─────────────┐  ┌───────────┐  ┌──────────────┐                       │
│     │  TUI Panel  │  │   OS      │  │   Web UI     │                       │
│     │  (Textual)  │  │  Notifs   │  │  (optional)  │                       │
│     └─────────────┘  └───────────┘  └──────────────┘                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components to Build

### 1. Hook Script (`~/.claude/hooks/monitor.py`)
Receives real-time events from all Claude Code instances, stores in SQLite.

```python
#!/usr/bin/env python3
import sys
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = .../data.db // TODO: Add the path to the database, should be in the same directory as this file

def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY,
            session_id TEXT,
            project_path TEXT,
            event_type TEXT,
            tool_name TEXT,
            data JSON,
            timestamp TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            project_path TEXT,
            status TEXT,
            initial_summary TEXT,
            recent_summary TEXT,
            current_activity TEXT,
            last_updated TEXT
        )
    ''')
    conn.commit()
    return conn

def main():
    event = json.load(sys.stdin)
    conn = init_db()
    
    # Store event
    conn.execute('''
        INSERT INTO events (session_id, project_path, event_type, tool_name, data, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        event.get('session_id'),
        event.get('project_path'),
        event.get('hook_type'),
        event.get('tool_name'),
        json.dumps(event),
        datetime.now().isoformat()
    ))
    
    # Update session status
    status = 'active'
    if event.get('hook_type') == 'Stop':
        reason = event.get('reason', '')
        status = 'permission_needed' if 'permission' in reason.lower() else 'stopped'
    
    conn.execute('''
        INSERT OR REPLACE INTO sessions (session_id, project_path, status, last_updated)
        VALUES (?, ?, ?, ?)
    ''', (
        event.get('session_id'),
        event.get('project_path'),
        status,
        datetime.now().isoformat()
    ))
    
    conn.commit()
    
    # Trigger notification if permission needed
    if status == 'permission_needed':
        import subprocess
        project = Path(event.get('project_path', '')).name
        subprocess.run([
            'osascript', '-e',
            f'display notification "Waiting for permission" with title "Claude Code: {project}"'
        ])
    
    # Always continue
    print(json.dumps({"continue": True}))

if __name__ == "__main__":
    main()
```

### 2. AI Summarizer Daemon (`summarizer.py`)
Background process that watches the database and generates AI summaries.

```python
#!/usr/bin/env python3
import sqlite3
import time
import json
from anthropic import Anthropic

client = Anthropic()
DB_PATH = "~/.claude-monitor/events.db"

def get_sessions_needing_summary(conn):
    return conn.execute('''
        SELECT session_id, project_path FROM sessions 
        WHERE initial_summary IS NULL 
           OR last_updated > datetime(initial_summary_updated, '+30 seconds')
    ''').fetchall()

def get_session_events(conn, session_id):
    return conn.execute('''
        SELECT data FROM events WHERE session_id = ? ORDER BY timestamp
    ''', (session_id,)).fetchall()

def generate_summaries(events):
    # Extract user messages
    user_messages = []
    for (data,) in events:
        e = json.loads(data)
        if e.get('hook_type') == 'PreToolUse':
            # Could be user input
            pass
    
    prompt = f"""Analyze this Claude Code session and provide:
1. INITIAL_GOAL: One sentence about what the user initially wanted (max 80 chars)
2. RECENT_ASKS: What the user asked in their last 2-3 messages (max 100 chars)
3. CURRENT_ACTIVITY: What Claude is doing right now (max 60 chars)

Session data:
{json.dumps([json.loads(e[0]) for e in events[-20:]], indent=2)}

Respond in JSON format only."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return json.loads(response.content[0].text)

def main():
    while True:
        conn = sqlite3.connect(DB_PATH)
        
        for session_id, project_path in get_sessions_needing_summary(conn):
            events = get_session_events(conn, session_id)
            if events:
                summaries = generate_summaries(events)
                conn.execute('''
                    UPDATE sessions SET
                        initial_summary = ?,
                        recent_summary = ?,
                        current_activity = ?
                    WHERE session_id = ?
                ''', (
                    summaries.get('INITIAL_GOAL'),
                    summaries.get('RECENT_ASKS'),
                    summaries.get('CURRENT_ACTIVITY'),
                    session_id
                ))
                conn.commit()
        
        conn.close()
        time.sleep(5)  # Check every 5 seconds

if __name__ == "__main__":
    main()
```

### 3. TUI Dashboard (`dashboard.py`)
Displays all projects in boxes with real-time status.

```python
#!/usr/bin/env python3
from textual.app import App, ComposeResult
from textual.widgets import Static, Footer
from textual.containers import VerticalScroll, Horizontal
from textual.reactive import reactive
from rich.panel import Panel
from rich.text import Text
from rich.progress import Progress, BarColumn
import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".claude-monitor" / "events.db"

class ProjectBox(Static):
    """A box showing one project's status."""
    
    def __init__(self, session_data: dict):
        super().__init__()
        self.session_data = session_data
    
    def render(self):
        d = self.session_data
        project_name = Path(d.get('project_path', 'Unknown')).name
        
        # Status indicator
        status = d.get('status', 'unknown')
        if status == 'active':
            indicator = "[bold green]● ACTIVE[/]"
        elif status == 'permission_needed':
            indicator = "[bold yellow]⚠ NEEDS PERMISSION[/]"
        else:
            indicator = "[dim]○ Idle[/]"
        
        # Build content
        content = Text()
        content.append(f"{indicator}\n\n")
        content.append("Goal: ", style="bold cyan")
        content.append(f"{d.get('initial_summary', 'Loading...')}\n\n")
        content.append("Recent: ", style="bold magenta")
        content.append(f"{d.get('recent_summary', '...')}\n\n")
        content.append("Now: ", style="bold yellow")
        content.append(f"{d.get('current_activity', '...')}\n")

        return Panel(
            content,
            title=f"[bold]{project_name}[/]",
            border_style="blue" if status == 'active' else "dim"
        )


class ClaudeMonitorApp(App):
    CSS = """
    ProjectBox {
        height: auto;
        min-height: 12;
        margin: 1;
    }
    """
    
    BINDINGS = [("q", "quit", "Quit"), ("r", "refresh", "Refresh")]
    
    def compose(self) -> ComposeResult:
        yield VerticalScroll(id="projects")
        yield Footer()
    
    def on_mount(self):
        self.load_projects()
        self.set_interval(5, self.load_projects)  # Refresh every 5s
    
    def load_projects(self):
        container = self.query_one("#projects")
        container.remove_children()
        
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            sessions = conn.execute('''
                SELECT * FROM sessions ORDER BY last_updated DESC
            ''').fetchall()
            conn.close()
            
            for session in sessions:
                container.mount(ProjectBox(dict(session)))
        except Exception as e:
            container.mount(Static(f"[red]Error loading: {e}[/]"))
    
    def action_refresh(self):
        self.load_projects()


if __name__ == "__main__":
    ClaudeMonitorApp().run()
```

---

## Open Questions / Decisions Needed

1. **AI Provider for Summaries**
   - Claude API (~$0.003/summary) — Best quality
   - OpenAI API — Alternative
   - Ollama (local) — Free, slightly worse quality

2. **Notification System**
   - macOS: `osascript` / terminal-notifier
   - Linux: `notify-send`
   - Cross-platform: `plyer` Python library

3. **Persistence**
   - SQLite (recommended) — Simple, file-based
   - JSON files — Simpler but less queryable
   - Redis — If you want pub/sub for real-time updates

---

## Next Steps

1. **Test hooks** — Verify Claude Code hooks work as expected
2. **Build hook script** — Start capturing events
3. **Build basic TUI** — Display raw event data first
4. **Add AI summarization** — Integrate Claude API
5. **Add notifications** — OS-level alerts
6. **Polish UI** — Progress bars, colors, layout

---

## Files Created So Far

- `claude_sessions.py` — Basic TUI (first iteration, file-watching approach)
- `pyproject.toml` — Package configuration
- `README.md` — Documentation

## Files Needed

- `~/.claude/hooks/monitor.py` — Hook script
- `summarizer.py` — AI summarization daemon  
- `dashboard.py` — Final TUI with project boxes
- `~/.claude/settings.json` — Hook configuration
