# Plan: Tool Usage Messages

## Overview

Extend the transcript processing to extract tool calls and store them as separate message rows with a `tools` JSON column containing structured tool data.

---

## 1. Database Schema Changes

### Modify `messages` table

Add `tools` and `is_todo` columns:

```sql
-- In schema.sql, modify messages table:
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    prompt_id INTEGER,
    uuid TEXT UNIQUE,
    is_user BOOLEAN DEFAULT 0,
    thinking BOOLEAN DEFAULT 0,
    is_todo BOOLEAN DEFAULT 0,  -- NEW: True for TodoWrite messages
    body TEXT,
    tools JSON,                  -- NEW: Tool data JSON
    created_at TEXT
);
```

- `tools` - `NULL` for regular text/thinking messages, populated for tool messages
- `is_todo` - `TRUE` for TodoWrite tool messages (for easy filtering/display)

### Tool JSON Structure

```python
# For Bash tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Bash",
    "status": "success" | "error",
    "input": {
        "command": "git status",
        "description": "Show working tree status"
    },
    "output": "On branch main\n...",
    "output_truncated": False
}

# For Edit tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Edit",
    "status": "success" | "error",
    "input": {
        "file_path": "/path/to/file.ts",
        "old_string": "...",
        "new_string": "...",
        "replace_all": False
    },
    "diff": "- old line\n+ new line\n...",  # Unified diff format
    "lines_added": 14,
    "lines_removed": 2,
    "diff_truncated": False  # True if diff was too large
}

# For Read tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Read",
    "status": "success" | "error",
    "input": {
        "file_path": "/path/to/file.ts",
        "offset": None,
        "limit": None
    },
    "output": "file contents...",
    "output_truncated": False
}

# For Write tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Write",
    "status": "success" | "error",
    "input": {
        "file_path": "/path/to/file.ts",
        "content": "new file content..."
    },
    "content_truncated": False
}

# For Grep tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Grep",
    "status": "success" | "error",
    "input": {
        "pattern": "function.*",
        "path": "/path",
        "glob": "*.ts",
        "output_mode": "files_with_matches"
    },
    "output": "file1.ts\nfile2.ts\n...",
    "output_truncated": False
}

# For Glob tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Glob",
    "status": "success" | "error",
    "input": {
        "pattern": "**/*.tsx",
        "path": "/path"
    },
    "output": "file1.tsx\nfile2.tsx\n...",
    "output_truncated": False
}

# For Task (subagent) tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "Task",
    "status": "success" | "error",
    "input": {
        "description": "Explore session chat messages",
        "prompt": "Find and analyze...",
        "subagent_type": "Explore"
    },
    "output": "Agent response...",
    "output_truncated": False
}

# For TodoWrite tools:
{
    "tool_use_id": "toolu_xxx",
    "name": "TodoWrite",
    "status": "success",
    "input": {
        "todos": [
            {"content": "Task 1", "status": "completed", "activeForm": "..."},
            {"content": "Task 2", "status": "in_progress", "activeForm": "..."}
        ]
    }
}
```

---

## 2. Python Processing Changes

### File: `worker.py`

#### 2.1 Constants for truncation

```python
MAX_OUTPUT_LENGTH = 10000      # Max chars for command output
MAX_DIFF_LENGTH = 5000         # Max chars for diff content
MAX_CONTENT_LENGTH = 10000     # Max chars for file content
```

#### 2.2 Helper function: Generate unified diff

```python
import difflib

def generate_diff(old_string: str, new_string: str, file_path: str) -> tuple[str, int, int]:
    """
    Generate unified diff and count lines changed.
    Returns: (diff_text, lines_added, lines_removed)
    """
    try:
        if not old_string and not new_string:
            return "", 0, 0

        old_lines = (old_string or "").splitlines(keepends=True)
        new_lines = (new_string or "").splitlines(keepends=True)

        diff = difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}",
            lineterm=""
        )

        diff_text = "".join(diff)

        # Count additions and deletions
        lines_added = sum(1 for line in diff_text.splitlines() if line.startswith('+') and not line.startswith('+++'))
        lines_removed = sum(1 for line in diff_text.splitlines() if line.startswith('-') and not line.startswith('---'))

        return diff_text, lines_added, lines_removed
    except Exception as e:
        # Return empty diff on error, log if needed
        return f"[Error generating diff: {str(e)}]", 0, 0
```

#### 2.3 Helper function: Truncate with flag

```python
def truncate_output(text: str, max_length: int) -> tuple[str, bool]:
    """Truncate text if too long. Returns (text, was_truncated)."""
    if len(text) <= max_length:
        return text, False
    return text[:max_length] + "\n... [truncated]", True
```

#### 2.4 Main processing logic changes

In `process_transcript`, add two-pass approach:

**Pass 1:** Collect all tool_use entries (from assistant messages)
**Pass 2:** Match with tool_result entries (from user messages)

```python
def process_transcript(conn, session_id: str, transcript_path: str) -> list[dict]:
    # ... existing setup code ...

    # Two-pass approach for tool matching
    tool_uses = {}      # tool_use_id -> {uuid, tool_data, timestamp}
    tool_results = {}   # tool_use_id -> {content, is_error}
    entries = []

    # First, read all entries with error handling
    try:
        with open(transcript_file, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                except json.JSONDecodeError:
                    continue
    except IOError as e:
        log(conn, "Error reading transcript file", session_id=session_id, error=str(e))
        return []

    # Pass 1: Collect tool_uses from assistant messages
    for entry in entries:
        try:
            if entry.get('type') == 'assistant':
                msg = entry.get('message', {})
                content_list = msg.get('content', [])
                if not isinstance(content_list, list):
                    continue
                for item in content_list:
                    if isinstance(item, dict) and item.get('type') == 'tool_use':
                        tool_use_id = item.get('id')
                        if not tool_use_id:
                            continue
                        tool_uses[tool_use_id] = {
                            'uuid': entry.get('uuid'),
                            'timestamp': entry.get('timestamp'),
                            'name': item.get('name'),
                            'input': item.get('input') or {}
                        }
        except Exception as e:
            # Log but continue processing other entries
            log(conn, "Error processing assistant entry", session_id=session_id, error=str(e))
            continue

    # Pass 2: Collect tool_results from user messages
    for entry in entries:
        try:
            if entry.get('type') == 'user':
                msg = entry.get('message', {})
                content = msg.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'tool_result':
                            tool_use_id = item.get('tool_use_id')
                            if not tool_use_id:
                                continue
                            tool_results[tool_use_id] = {
                                'content': item.get('content'),
                                'is_error': item.get('is_error', False)
                            }
        except Exception as e:
            log(conn, "Error processing user entry", session_id=session_id, error=str(e))
            continue

    # Pass 3: Process matched tool calls
    for tool_use_id, tool_use in tool_uses.items():
        try:
            if message_exists(conn, tool_use_id):  # Use tool_use_id as uuid
                continue

            result = tool_results.get(tool_use_id, {})
            tool_json = build_tool_json(tool_use, result)

            if tool_json:
                is_todo = (tool_use.get('name') == 'TodoWrite')
                msg_id = create_message(
                    conn, prompt_id,
                    uuid=tool_use_id,  # Use tool_use_id as unique identifier
                    created_at=tool_use.get('timestamp'),
                    body=None,  # No text body for tool messages
                    is_thinking=False,
                    is_user=False,
                    tools=json.dumps(tool_json),  # New parameter
                    is_todo=is_todo                # New parameter
                )
                new_messages.append({
                    'id': msg_id,
                    'prompt_id': prompt_id,
                    'uuid': tool_use_id,
                    'is_user': False,
                    'thinking': False,
                    'is_todo': is_todo,
                    'body': None,
                    'tools': tool_json,
                    'created_at': tool_use.get('timestamp'),
                    'prompt_text': None,
                })
        except Exception as e:
            log(conn, "Error processing tool call", session_id=session_id, tool_id=tool_use_id, error=str(e))
            continue

    # ... existing text message processing ...
```

#### 2.5 Build tool JSON function

```python
def build_tool_json(tool_use: dict, result: dict) -> dict | None:
    """Build the tool JSON structure based on tool type."""
    try:
        name = tool_use.get('name')
        if not name:
            return None

        input_data = tool_use.get('input') or {}
        result_content = result.get('content', '')
        is_error = result.get('is_error', False)

        # Extract text from result content (can be string or list)
        output_text = ""
        try:
            if isinstance(result_content, list):
                for item in result_content:
                    if isinstance(item, dict) and item.get('type') == 'text':
                        output_text += item.get('text', '')
            elif result_content:
                output_text = str(result_content)
        except Exception:
            output_text = "[Error extracting output]"

        base = {
            'tool_use_id': tool_use.get('uuid', ''),
            'name': name,
            'status': 'error' if is_error else 'success',
        }

        if name == 'Bash':
            output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
            return {
                **base,
                'input': {
                    'command': input_data.get('command', ''),
                    'description': input_data.get('description'),
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'Edit':
            old_string = input_data.get('old_string') or ''
            new_string = input_data.get('new_string') or ''
            file_path = input_data.get('file_path') or ''

            diff_text, lines_added, lines_removed = generate_diff(old_string, new_string, file_path)

            diff_truncated = False
            if len(diff_text) > MAX_DIFF_LENGTH:
                diff_text = "[Diff too large to display]"
                diff_truncated = True

            return {
                **base,
                'input': {
                    'file_path': file_path,
                    'replace_all': input_data.get('replace_all', False),
                },
                'diff': diff_text,
                'lines_added': lines_added,
                'lines_removed': lines_removed,
                'diff_truncated': diff_truncated,
            }

        elif name == 'Read':
            output, truncated = truncate_output(output_text, MAX_CONTENT_LENGTH)
            return {
                **base,
                'input': {
                    'file_path': input_data.get('file_path') or '',
                    'offset': input_data.get('offset'),
                    'limit': input_data.get('limit'),
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'Write':
            content = input_data.get('content') or ''
            content, truncated = truncate_output(content, MAX_CONTENT_LENGTH)
            return {
                **base,
                'input': {
                    'file_path': input_data.get('file_path') or '',
                },
                'content': content,
                'content_truncated': truncated,
            }

        elif name in ('Grep', 'Glob'):
            output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
            return {
                **base,
                'input': {
                    'pattern': input_data.get('pattern') or input_data.get('glob') or '',
                    'path': input_data.get('path'),
                    'glob': input_data.get('glob'),
                    'output_mode': input_data.get('output_mode'),
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'Task':
            output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
            return {
                **base,
                'input': {
                    'description': input_data.get('description') or '',
                    'subagent_type': input_data.get('subagent_type') or '',
                },
                'output': output,
                'output_truncated': truncated,
            }

        elif name == 'TodoWrite':
            todos = input_data.get('todos') or []
            # Validate todos structure
            if not isinstance(todos, list):
                todos = []
            return {
                **base,
                'input': {
                    'todos': todos,
                },
            }

        # Generic fallback for other/unknown tools
        output, truncated = truncate_output(output_text, MAX_OUTPUT_LENGTH)
        return {
            **base,
            'input': input_data,  # Keep original input for unknown tools
            'output': output,
            'output_truncated': truncated,
        }

    except Exception as e:
        # Return minimal error info if processing fails completely
        return {
            'tool_use_id': tool_use.get('uuid', ''),
            'name': tool_use.get('name', 'Unknown'),
            'status': 'error',
            'input': {},
            'output': f"[Error processing tool: {str(e)}]",
            'output_truncated': False,
        }
```

---

## 3. Database Function Changes

### File: `db.py`

#### 3.1 Update `create_message` function

```python
def create_message(
    conn: sqlite3.Connection,
    prompt_id: int,
    uuid: str,
    created_at: str,
    body: str | None,  # Now nullable
    is_thinking: bool,
    is_user: bool,
    tools: str | None = None,  # New parameter, JSON string
    is_todo: bool = False       # New parameter for TodoWrite messages
) -> int:
    """Create a new message."""
    cursor = conn.execute('''
        INSERT INTO messages (prompt_id, uuid, created_at, body, thinking, is_user, tools, is_todo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (prompt_id, uuid, created_at, body, is_thinking, is_user, tools, is_todo))
    return cursor.lastrowid
```

---

## 4. TypeScript Type Changes

### File: `app/src/types.ts`

```typescript
// Tool input types
interface BashInput {
  command: string
  description?: string
}

interface EditInput {
  file_path: string
  replace_all?: boolean
}

interface ReadInput {
  file_path: string
  offset?: number
  limit?: number
}

interface WriteInput {
  file_path: string
}

interface GrepInput {
  pattern: string
  path?: string
  glob?: string
  output_mode?: string
}

interface TaskInput {
  description: string
  subagent_type: string
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

interface TodoWriteInput {
  todos: TodoItem[]
}

// Tool data types
interface BaseTool {
  tool_use_id: string
  name: string
  status: 'success' | 'error'
}

interface BashTool extends BaseTool {
  name: 'Bash'
  input: BashInput
  output: string
  output_truncated: boolean
}

interface EditTool extends BaseTool {
  name: 'Edit'
  input: EditInput
  diff: string
  lines_added: number
  lines_removed: number
  diff_truncated: boolean
}

interface ReadTool extends BaseTool {
  name: 'Read'
  input: ReadInput
  output: string
  output_truncated: boolean
}

interface WriteTool extends BaseTool {
  name: 'Write'
  input: WriteInput
  content: string
  content_truncated: boolean
}

interface GrepTool extends BaseTool {
  name: 'Grep' | 'Glob'
  input: GrepInput
  output: string
  output_truncated: boolean
}

interface TaskTool extends BaseTool {
  name: 'Task'
  input: TaskInput
  output: string
  output_truncated: boolean
}

interface TodoWriteTool extends BaseTool {
  name: 'TodoWrite'
  input: TodoWriteInput
}

type ToolData = BashTool | EditTool | ReadTool | WriteTool | GrepTool | TaskTool | TodoWriteTool

// Update Message interface
export interface Message {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  is_todo: boolean       // New field for TodoWrite messages
  body: string | null    // Now nullable
  tools: ToolData | null // New field
  created_at: string
}
```

---

## 5. API Changes

### File: `app/server/db.ts`

#### 5.1 Update `getAllSessions` - exclude tool messages from latest_agent_message

```typescript
export function getAllSessions(): SessionWithProject[] {
  return db
    .prepare(`
      SELECT
        s.*,
        p.path as project_path,
        (
          SELECT pr.prompt FROM prompts pr
          WHERE pr.session_id = s.session_id AND pr.prompt IS NOT NULL
          ORDER BY pr.created_at DESC LIMIT 1
        ) as latest_user_message,
        (
          SELECT m.body FROM messages m
          JOIN prompts pr ON m.prompt_id = pr.id
          WHERE pr.session_id = s.session_id
            AND m.is_user = 0
            AND m.tools IS NULL  -- Exclude tool messages
            AND m.thinking = 0   -- Exclude thinking messages
          ORDER BY m.created_at DESC LIMIT 1
        ) as latest_agent_message
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      ORDER BY s.updated_at DESC
    `)
    .all() as SessionWithProject[]
}
```

#### 5.2 Update `getSessionMessages` to include tools and is_todo:

```typescript
export function getSessionMessages(
  sessionId: string,
  limit: number,
  offset: number,
): SessionMessagesResult {
  // ... existing count query ...

  const messages = db
    .prepare(`
      SELECT
        m.id,
        m.prompt_id,
        m.uuid,
        m.is_user,
        m.thinking,
        m.is_todo,  -- Add this
        m.body,
        m.tools,    -- Add this
        m.created_at,
        p.prompt as prompt_text
      FROM messages m
      JOIN prompts p ON m.prompt_id = p.id
      WHERE p.session_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(sessionId, limit, offset) as (SessionMessage & { tools: string | null })[]

  // Parse tools JSON and convert is_todo to boolean
  const parsedMessages = messages.map(m => ({
    ...m,
    is_todo: Boolean(m.is_todo),
    tools: m.tools ? JSON.parse(m.tools) : null,
  }))

  return {
    messages: parsedMessages,
    total: total.count,
    hasMore: offset + messages.length < total.count,
  }
}
```

---

## 6. NPM Packages

**No additional packages needed.** We will use:

- **Custom `DiffView` component** - Simple line-by-line renderer for unified diff (lightweight, matches our theme)
- **`react-syntax-highlighter`** - Already installed, use for code in Read/Write output

The custom DiffView approach is preferred because:
1. We generate unified diff format in Python (simple to parse)
2. Keeps bundle size small
3. Full control over styling to match zinc theme

---

## 7. Frontend Components

### File: `app/src/components/ToolCallDisplay.tsx`

```typescript
// Main component that renders based on tool type
export function ToolCallDisplay({ tool }: { tool: ToolData }) {
  switch (tool.name) {
    case 'Bash':
      return <BashToolDisplay tool={tool} />
    case 'Edit':
      return <EditToolDisplay tool={tool} />
    case 'Read':
      return <ReadToolDisplay tool={tool} />
    // ... etc
  }
}

// Bash display with collapsible output
function BashToolDisplay({ tool }: { tool: BashTool }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="...">
      <div className="flex items-center gap-2">
        <StatusDot status={tool.status} />
        <span className="font-mono text-sm">
          Bash({tool.input.command})
        </span>
      </div>
      {tool.output && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleContent>
            <pre className="...">{tool.output}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

// Edit display with diff view
function EditToolDisplay({ tool }: { tool: EditTool }) {
  return (
    <div className="...">
      <div className="flex items-center gap-2">
        <StatusDot status={tool.status} />
        <span className="font-mono text-sm">
          Update({tool.input.file_path})
        </span>
        <span className="text-xs text-muted-foreground">
          Added {tool.lines_added}, removed {tool.lines_removed}
        </span>
      </div>
      {tool.diff_truncated ? (
        <p className="text-muted-foreground">[Diff too large to display]</p>
      ) : (
        <DiffView diff={tool.diff} />
      )}
    </div>
  )
}
```

### File: `app/src/components/DiffView.tsx`

```typescript
// Renders unified diff with syntax highlighting
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n')

  return (
    <div className="font-mono text-xs">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith('+') && !line.startsWith('+++') && 'bg-green-900/30 text-green-400',
            line.startsWith('-') && !line.startsWith('---') && 'bg-red-900/30 text-red-400',
            line.startsWith('@@') && 'text-blue-400',
          )}
        >
          {line}
        </div>
      ))}
    </div>
  )
}
```

---

## 8. Update MessageBubble

Modify to handle tool messages:

```typescript
export function MessageBubble({ message }: MessageBubbleProps) {
  // If it's a tool message, render ToolCallDisplay
  if (message.tools) {
    return <ToolCallDisplay tool={message.tools} />
  }

  // Otherwise render normal message
  // ... existing code ...
}
```

---

## 9. Implementation Order

1. **Schema**: Add `tools` and `is_todo` columns to messages table
2. **db.py**: Update `create_message` to accept `tools` and `is_todo` parameters
3. **worker.py**:
   - Add helper functions (`generate_diff`, `truncate_output`, `build_tool_json`)
   - Update `process_transcript` with two-pass tool processing
   - Set `is_todo=True` for TodoWrite messages
4. **types.ts**: Add tool type definitions and `is_todo` to Message interface
5. **server/db.ts**:
   - Update `getAllSessions` to exclude tool messages from `latest_agent_message`
   - Update `getSessionMessages` to include and parse tools + is_todo
6. **Components**: Create `ToolCallDisplay`, `DiffView`, `BashToolDisplay`, etc.
7. **MessageBubble**: Update to render tool messages

---

## 10. Migration Note

Since user said "no migration", the schema change uses `ALTER TABLE ADD COLUMN` which works on existing tables without data loss. The new column will be `NULL` for existing messages.
