# Migration Plan: SQLite to PostgreSQL + NOTIFY/LISTEN

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Current vs Target Architecture](#2-current-vs-target-architecture)
3. [Schema Migration](#3-schema-migration)
4. [NOTIFY/LISTEN Design](#4-notifylisten-design)
5. [Data Parity Analysis](#5-data-parity-analysis)
6. [Python Changes](#6-python-changes)
7. [Node.js Changes](#7-nodejs-changes)
8. [run.sh Changes](#8-runsh-changes)
9. [Files Changed](#9-files-changed)
10. [Migration Sequence](#10-migration-sequence)

---

## 1. Architecture Overview

### Current Architecture

```
Claude Code CLI hooks
        │
        ▼
  monitor.py ──writes──► SQLite (data.db) ◄──reads── Fastify server
        │                                              │
        ├─ spawns socket_worker.py ─── HTTP POST ──►  /api/emit ──► Socket.IO ──► React
        ├─ spawns worker.py (transcript) ─ HTTP POST ► /api/emit ──► Socket.IO ──► React
        └─ spawns cleanup_worker.py
```

**Problem:** Python is coupled to the webapp via HTTP calls to `/api/emit`. If the Node.js server is down, hook events and transcript updates are lost. The Python processes must know the server's URL and port.

### Target Architecture

```
Claude Code CLI hooks
        │
        ▼
  monitor.py ──writes──► PostgreSQL ──NOTIFY──► Fastify server ──► Socket.IO ──► React
        │                     ▲
        ├─ spawns worker.py ──┘ (writes + NOTIFY)
        └─ spawns cleanup_worker.py
```

**Benefit:** Python only writes to PostgreSQL. The Node.js server listens to PostgreSQL notifications via `LISTEN`. No HTTP coupling between Python and Node.js. `socket_worker.py` is eliminated entirely.

---

## 2. Current vs Target Architecture

| Aspect | Current (SQLite) | Target (PostgreSQL) |
|--------|-----------------|-------------------|
| Database | SQLite `data.db` file | PostgreSQL server |
| Python → Client | Python → HTTP POST `/api/emit` → Socket.IO | Python → `INSERT` + `pg_notify()` → PostgreSQL → Node.js `LISTEN` → Socket.IO |
| socket_worker.py | Required (bridges Python → Node.js) | **Eliminated** |
| Connection config | `DB_NAME=data.db` env var | `DATABASE_URL=postgresql://...` env var |
| Concurrency | WAL mode + busy_timeout | Native MVCC, connection pooling |
| Python library | `sqlite3` (stdlib) | `psycopg2` |
| Node.js library | `better-sqlite3` (sync) | `pg` (async) |
| Real-time notifications | HTTP POST relay | PostgreSQL NOTIFY/LISTEN |

---

## 3. Schema Migration

### 3.1 PostgreSQL Schema (`schema.sql`)

All tables translated from SQLite to PostgreSQL. Key differences:
- `INTEGER PRIMARY KEY` → `SERIAL PRIMARY KEY`
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `TEXT DEFAULT CURRENT_TIMESTAMP` → `TIMESTAMPTZ DEFAULT NOW()`
- `BOOLEAN DEFAULT 0` → `BOOLEAN DEFAULT FALSE`
- `JSON` → `JSONB`
- SQLite triggers → PostgreSQL trigger functions
- SQLite `datetime('now', '-7 days')` → `NOW() - INTERVAL '7 days'`

```sql
-- PostgreSQL Schema for WorkIO

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    path TEXT UNIQUE
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    terminal_id INTEGER,
    name TEXT,
    message_count INTEGER,
    status TEXT,
    transcript_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompts table
CREATE TABLE IF NOT EXISTS prompts (
    id SERIAL PRIMARY KEY,
    session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
    prompt TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    prompt_id INTEGER REFERENCES prompts(id) ON DELETE CASCADE,
    uuid TEXT UNIQUE,
    is_user BOOLEAN DEFAULT FALSE,
    thinking BOOLEAN DEFAULT FALSE,
    todo_id TEXT,
    body TEXT,
    tools JSONB,
    images JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hooks table
CREATE TABLE IF NOT EXISTS hooks (
    id SERIAL PRIMARY KEY,
    session_id TEXT,
    hook_type TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleans table
CREATE TABLE IF NOT EXISTS cleans (
    id SERIAL PRIMARY KEY,
    type TEXT DEFAULT 'data',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Terminals table
CREATE TABLE IF NOT EXISTS terminals (
    id SERIAL PRIMARY KEY,
    cwd TEXT NOT NULL,
    name TEXT,
    shell TEXT,
    ssh_host TEXT,
    pid INTEGER,
    status TEXT DEFAULT 'running',
    active_cmd TEXT,
    git_branch TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table (singleton with JSONB config)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cleans_type ON cleans(type);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_hooks_type ON hooks(hook_type);
CREATE INDEX IF NOT EXISTS idx_terminals_status ON terminals(status);
CREATE INDEX IF NOT EXISTS idx_prompts_session_id ON prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_prompt_id ON messages(prompt_id);
CREATE INDEX IF NOT EXISTS idx_messages_todo_id ON messages(todo_id);

-- Trigger function: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sessions_updated_at') THEN
        CREATE TRIGGER sessions_updated_at
            BEFORE UPDATE ON sessions
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_updated_at') THEN
        CREATE TRIGGER messages_updated_at
            BEFORE UPDATE ON messages
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END;
$$;

-- Insert default settings row if not present
INSERT INTO settings (id, config) VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;
```

### 3.2 Key Schema Differences

| SQLite | PostgreSQL | Notes |
|--------|-----------|-------|
| `INTEGER PRIMARY KEY` | `SERIAL PRIMARY KEY` | Auto-incrementing |
| `TEXT DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT NOW()` | Timezone-aware timestamps |
| `BOOLEAN DEFAULT 0` | `BOOLEAN DEFAULT FALSE` | Native booleans |
| `JSON` | `JSONB` | Binary JSON, indexable |
| `INSERT OR ... ON CONFLICT` | `INSERT ... ON CONFLICT ... DO UPDATE SET` | Same concept, slightly different syntax |
| `datetime('now', '-7 days')` | `NOW() - INTERVAL '7 days'` | Interval arithmetic |
| Trigger updates `SET updated_at = ...` | Trigger uses `BEFORE UPDATE` returning `NEW` | PostgreSQL triggers modify NEW row |
| `PRAGMA journal_mode=WAL` | N/A | PostgreSQL uses WAL by default |
| `PRAGMA busy_timeout=5000` | Connection pool settings | Handled at connection level |

### 3.3 Additional Indexes

The PostgreSQL schema adds indexes that weren't in SQLite but improve query performance:
- `idx_prompts_session_id` — used in JOIN queries for messages
- `idx_messages_prompt_id` — used in JOIN queries for session messages
- `idx_messages_todo_id` — used for todo upsert lookups

---

## 4. NOTIFY/LISTEN Design

### 4.1 Channels

Two NOTIFY channels replace the HTTP POST relay:

| Channel | Emitted by | Payload | Purpose |
|---------|-----------|---------|---------|
| `hook` | `monitor.py` after upserting session | `{session_id, hook_type, status, project_path, terminal_id}` | Session status changes |
| `session_update` | `worker.py` after processing transcript | `{session_id, message_ids: [1, 2, 3]}` | New messages available |

### 4.2 Payload Size Consideration

PostgreSQL NOTIFY payloads are limited to **8000 bytes**.

- **`hook` channel:** Payload is ~150-300 bytes (session_id, hook_type, status, project_path, terminal_id). Well within limits.
- **`session_update` channel:** We send `{session_id, message_ids: [...]}` instead of full message objects. Message IDs are integers, so even 100 new messages would be ~500 bytes. The Node.js server then queries the DB for the full message data.

**This is the key design decision:** We do NOT send full message content via NOTIFY. Instead, we send message IDs and let Node.js query for the data. This avoids the 8000-byte limit since tool output/body content can be up to 50,000 characters.

### 4.3 Python-Side: Emitting Notifications

Python calls `pg_notify()` directly after its DB operations. This happens within the same transaction so notifications are only sent if the transaction commits successfully.

```python
# In monitor.py - after upserting session
conn.execute(
    "SELECT pg_notify('hook', %s)",
    (json.dumps({
        "session_id": session_id,
        "hook_type": hook_type,
        "status": status,
        "project_path": project_path,
        "terminal_id": terminal_id,
    }),)
)
conn.commit()  # NOTIFY is delivered on commit
```

```python
# In worker.py - after processing transcript
if new_messages:
    message_ids = [m['id'] for m in new_messages]
    conn.execute(
        "SELECT pg_notify('session_update', %s)",
        (json.dumps({
            "session_id": session_id,
            "message_ids": message_ids,
        }),)
    )
    conn.commit()
```

**Important:** PostgreSQL delivers NOTIFY messages only after the transaction commits. This guarantees the data is available in the DB when Node.js receives the notification.

### 4.4 Node.js-Side: Listening for Notifications

The Node.js server establishes a **dedicated persistent connection** for LISTEN (separate from the query pool). This is required because `LISTEN` must remain on the same connection.

```typescript
// server/listen.ts — PostgreSQL LISTEN handler
import pg from 'pg'
import { Server as SocketIOServer } from 'socket.io'

export async function initPgListener(io: SocketIOServer, connectionString: string) {
    const client = new pg.Client({ connectionString })
    await client.connect()

    await client.query('LISTEN hook')
    await client.query('LISTEN session_update')

    client.on('notification', async (msg) => {
        if (!msg.payload) return
        const payload = JSON.parse(msg.payload)

        if (msg.channel === 'hook') {
            // Broadcast directly — payload matches current Socket.IO event shape
            io.emit('hook', payload)
        }

        if (msg.channel === 'session_update') {
            // Query DB for full message data, then broadcast
            const messages = await getMessagesByIds(payload.message_ids)
            io.emit('session_update', {
                session_id: payload.session_id,
                messages,
            })
        }
    })

    // Reconnect on error
    client.on('error', (err) => {
        log.error({ err }, 'LISTEN connection error, reconnecting...')
        setTimeout(() => initPgListener(io, connectionString), 1000)
    })
}
```

### 4.5 What Gets Eliminated

With NOTIFY/LISTEN, the following are **removed**:

| Removed | Reason |
|---------|--------|
| `socket_worker.py` | No longer needed — Python uses `pg_notify()` instead of HTTP POST |
| `socket_queue/` directory | File-based locking for socket emission no longer needed |
| `POST /api/emit` endpoint | Node.js receives events via LISTEN, not HTTP |
| `start_socket_worker()` in `monitor.py` | Replaced by `pg_notify()` call |
| `emit_event()` calls in `worker.py` | Replaced by `pg_notify()` call |
| `requests` Python dependency | No more HTTP calls from Python to Node.js |

---

## 5. Data Parity Analysis

### 5.1 Does the client receive the same data?

**Yes.** The client receives identical data structures. Here's the comparison:

#### `hook` Event

| Field | Current (HTTP POST) | Target (NOTIFY/LISTEN) | Same? |
|-------|-------------------|----------------------|-------|
| `session_id` | From `monitor.py` dict | From `pg_notify` payload | Yes |
| `hook_type` | From `monitor.py` dict | From `pg_notify` payload | Yes |
| `status` | From `monitor.py` dict | From `pg_notify` payload | Yes |
| `project_path` | From `monitor.py` dict | From `pg_notify` payload | Yes |
| `terminal_id` | From `monitor.py` dict | From `pg_notify` payload | Yes |

The `hook` event payload is constructed identically in both approaches. Python builds the same dict and passes it to `pg_notify()` instead of `emit_event()`.

#### `session_update` Event

| Field | Current (HTTP POST) | Target (NOTIFY + DB query) | Same? |
|-------|-------------------|--------------------------|-------|
| `session_id` | From `worker.py` | From `pg_notify` payload | Yes |
| `messages` | Built in-memory by `worker.py`, sent via HTTP | IDs sent via `pg_notify`, full messages queried by Node.js | Yes |

The message objects in `session_update` currently contain:
```
id, prompt_id, uuid, is_user, thinking, todo_id, body, tools, images, created_at, prompt_text
```

With NOTIFY/LISTEN, Node.js queries the messages by ID and returns the same fields. The data structure is identical.

**One difference:** Currently `worker.py` builds the message dict in Python and sends it directly. With NOTIFY/LISTEN, Node.js queries the DB and constructs the same shape. We need a `getMessagesByIds()` function in the Node.js DB layer that returns the same fields.

### 5.2 Data stored in the database

The database stores exactly the same data regardless of notification mechanism. The tables, columns, and data types are equivalent (just adapted for PostgreSQL syntax). All INSERT/UPDATE operations remain the same.

### 5.3 Real-time event timing

| Aspect | Current | Target | Impact |
|--------|---------|--------|--------|
| Hook events | Python → HTTP POST → Socket.IO (async subprocess) | Python → NOTIFY (same transaction) → Node.js LISTEN → Socket.IO | Slightly faster (no HTTP round-trip, no subprocess spawn) |
| Session updates | Worker → HTTP POST → Socket.IO | Worker → NOTIFY → Node.js query → Socket.IO | Similar latency (NOTIFY is fast, extra DB query is local) |
| Delivery guarantee | Fire-and-forget HTTP (can fail silently) | NOTIFY delivered on commit (guaranteed if committed) | More reliable |

### 5.4 Edge cases

- **Node.js server is down:** Current approach loses events (HTTP POST fails). With NOTIFY/LISTEN, notifications sent while Node.js is disconnected are lost too — PostgreSQL only delivers to currently-connected listeners. However, the data is always in the database, and the client re-fetches on reconnect via SWR.
- **Multiple Node.js instances:** NOTIFY is delivered to ALL listeners on all connections. If running multiple server instances, each would receive and broadcast — the client already deduplicates messages by ID, so this is safe.

---

## 6. Python Changes

### 6.1 `db.py` — Database Connection

Replace `sqlite3` with `psycopg2`. All query parameters change from `?` to `%s`.

**Current:**
```python
import sqlite3
DB_PATH = Path(__file__).parent / os.environ.get("DB_NAME", "data.db")

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.row_factory = sqlite3.Row
    return conn
```

**Target:**
```python
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/workio")

def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn

def get_cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
```

Key changes across all functions in `db.py`:
- `conn.execute(sql, params)` → `cursor.execute(sql, params)` (psycopg2 uses cursor)
- `?` placeholders → `%s` placeholders
- `conn.row_factory = sqlite3.Row` → `cursor_factory=RealDictCursor`
- `cursor.lastrowid` → `cursor.execute(...RETURNING id)` + `cursor.fetchone()['id']`
- `fetchone()['field']` stays the same with RealDictCursor
- `conn.executescript()` → split and execute statements individually or use `cursor.execute()` with the full SQL (psycopg2 supports multi-statement execute)

### 6.2 `db.py` — Query Changes

Every function in `db.py` needs parameter placeholder changes. Key examples:

```python
# upsert_session: ON CONFLICT syntax is compatible
def upsert_session(conn, session_id, project_id, status, transcript_path, terminal_id=None):
    cur = get_cursor(conn)
    cur.execute('''
        INSERT INTO sessions (session_id, project_id, terminal_id, status, transcript_path)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT(session_id) DO UPDATE SET
            terminal_id = COALESCE(EXCLUDED.terminal_id, sessions.terminal_id),
            status = EXCLUDED.status,
            transcript_path = EXCLUDED.transcript_path
    ''', (session_id, project_id, terminal_id, status, transcript_path))

# create_prompt: use RETURNING for lastrowid
def create_prompt(conn, session_id, prompt_text=None):
    cur = get_cursor(conn)
    cur.execute('''
        INSERT INTO prompts (session_id, prompt) VALUES (%s, %s)
        RETURNING id
    ''', (session_id, prompt_text))
    return cur.fetchone()['id']

# create_message: use RETURNING
def create_message(conn, prompt_id, uuid, created_at, body, is_thinking, is_user, tools=None, todo_id=None, images=None):
    cur = get_cursor(conn)
    cur.execute('''
        INSERT INTO messages (prompt_id, uuid, created_at, body, thinking, is_user, tools, todo_id, images)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    ''', (prompt_id, uuid, created_at, body, is_thinking, is_user, tools, todo_id, images))
    return cur.fetchone()['id']
```

### 6.3 `db.py` — New: `notify()` helper

```python
def notify(conn, channel: str, payload: dict) -> None:
    """Send a PostgreSQL NOTIFY with JSON payload."""
    cur = conn.cursor()
    cur.execute("SELECT pg_notify(%s, %s)", (channel, json.dumps(payload)))
```

### 6.4 `monitor.py` — Replace socket_worker with pg_notify

**Remove:**
- `start_socket_worker()` function
- `subprocess.Popen` call for socket_worker.py
- Import of `subprocess` for socket worker (still needed for worker.py and cleanup_worker.py)

**Replace with:**
```python
# After upserting session and committing:
from db import notify

notify(conn, "hook", {
    "session_id": session_id,
    "hook_type": hook_type,
    "status": status,
    "project_path": project_path,
    "terminal_id": terminal_id,
})
conn.commit()
```

The key change is that `notify()` is called **before** `conn.commit()` so the NOTIFY is part of the same transaction. PostgreSQL only delivers the notification when the transaction commits.

The full `monitor.py` main flow becomes:
1. Read hook event from stdin
2. Init DB, log hook, save to hooks table
3. Determine status, upsert project + session
4. Handle SessionStart/UserPromptSubmit specifics
5. **Call `notify(conn, "hook", {...})`**
6. **`conn.commit()`** — this delivers the NOTIFY
7. Spawn `worker.py` (debounced) and `cleanup_worker.py`
8. Print `{"continue": true}`

### 6.5 `worker.py` — Replace emit_event with pg_notify

**Remove:**
- `from socket_worker import emit_event` import
- `emit_event("session_update", ...)` call

**Replace with:**
```python
from db import notify

# After process_transcript() returns new_messages:
if new_messages:
    message_ids = [m['id'] for m in new_messages]
    notify(conn, "session_update", {
        "session_id": session_id,
        "message_ids": message_ids,
    })
conn.commit()
```

### 6.6 `cleanup_worker.py` — Query Changes

All datetime functions change:
- `datetime('now', '-7 days')` → `NOW() - INTERVAL '7 days'`
- `datetime('now', '-3 days')` → `NOW() - INTERVAL '3 days'`
- `datetime('now', ?)` → `NOW() + INTERVAL %s` (with parameterized interval)

### 6.7 `socket_worker.py` — Deleted

This file is completely removed. Its functionality is replaced by `pg_notify()`.

### 6.8 Python Dependencies

**Remove:** `requests` (no longer needed for HTTP POST)
**Add:** `psycopg2-binary` (PostgreSQL adapter)

Update in `run.sh`:
```bash
# Before:
python3 -m pip install -q python-dotenv requests
# After:
python3 -m pip install -q python-dotenv psycopg2-binary
```

---

## 7. Node.js Changes

### 7.1 Replace `better-sqlite3` with `pg`

**Dependencies:**
```bash
npm uninstall better-sqlite3 @types/better-sqlite3
npm install pg @types/pg
```

### 7.2 `server/db.ts` — Connection Pool

Replace synchronous `better-sqlite3` with async `pg` Pool:

```typescript
import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
    connectionString: env.DATABASE_URL,
})

// Initialize schema on startup
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
await pool.query(schema)
```

### 7.3 `server/db.ts` — All Functions Become Async

Every DB function changes from synchronous to async. Parameter placeholders change from `?` to `$1, $2, ...`.

**Example — `getAllSessions`:**

```typescript
// Before (sync, better-sqlite3):
export function getAllSessions(): SessionWithProject[] {
    return db.prepare(`${SESSION_SELECT} ORDER BY ...`).all() as SessionWithProject[]
}

// After (async, pg):
export async function getAllSessions(): Promise<SessionWithProject[]> {
    const { rows } = await pool.query(`${SESSION_SELECT} ORDER BY s.updated_at DESC`)
    return rows
}
```

**Example — `getSessionMessages`:**

```typescript
// Before: db.prepare(...).get(sessionId) / .all(sessionId, limit, offset)
// After:
export async function getSessionMessages(sessionId: string, limit: number, offset: number): Promise<SessionMessagesResult> {
    const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM messages m JOIN prompts p ON m.prompt_id = p.id WHERE p.session_id = $1`,
        [sessionId]
    )
    const total = parseInt(countResult.rows[0].count)

    const { rows } = await pool.query(
        `SELECT m.*, p.prompt as prompt_text FROM messages m
         JOIN prompts p ON m.prompt_id = p.id
         WHERE p.session_id = $1
         ORDER BY COALESCE(m.updated_at, m.created_at) DESC
         LIMIT $2 OFFSET $3`,
        [sessionId, limit, offset]
    )

    // PostgreSQL returns JSONB as objects (no need to JSON.parse)
    // PostgreSQL returns BOOLEAN as true/false (no need to convert)
    return { messages: rows, total, hasMore: offset + rows.length < total }
}
```

### 7.4 `server/db.ts` — New: `getMessagesByIds()`

This function is needed for the NOTIFY/LISTEN handler to query messages by their IDs (sent in the `session_update` notification payload):

```typescript
export async function getMessagesByIds(ids: number[]): Promise<SessionMessage[]> {
    if (ids.length === 0) return []

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await pool.query(
        `SELECT m.id, m.prompt_id, m.uuid, m.is_user, m.thinking, m.todo_id,
                m.body, m.tools, m.images, m.created_at, m.updated_at,
                p.prompt as prompt_text
         FROM messages m
         JOIN prompts p ON m.prompt_id = p.id
         WHERE m.id IN (${placeholders})
         ORDER BY m.id`,
        ids
    )
    return rows
}
```

### 7.5 `server/env.ts` — New Env Variable

```typescript
const envSchema = z.object({
    DATABASE_URL: z.string().default('postgresql://localhost/workio'),
    // DB_NAME removed
    SERVER_PORT: z.coerce.number().default(5176),
    CLIENT_PORT: z.coerce.number().default(5175),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = {
    ...parsed.data,
    ROOT_DIR: rootDir,
    // DB_PATH removed
}
```

### 7.6 `server/listen.ts` — New File: PostgreSQL LISTEN Handler

```typescript
import pg from 'pg'
import type { Server as SocketIOServer } from 'socket.io'
import { getMessagesByIds } from './db'
import { log } from './logger'

let listenerClient: pg.Client | null = null

export async function initPgListener(io: SocketIOServer, connectionString: string) {
    listenerClient = new pg.Client({ connectionString })
    await listenerClient.connect()

    await listenerClient.query('LISTEN hook')
    await listenerClient.query('LISTEN session_update')

    listenerClient.on('notification', async (msg) => {
        if (!msg.payload) return

        try {
            const payload = JSON.parse(msg.payload)

            if (msg.channel === 'hook') {
                io.emit('hook', payload)
                log.info({ payload }, 'LISTEN: hook event')
            }

            if (msg.channel === 'session_update') {
                const messages = await getMessagesByIds(payload.message_ids)
                io.emit('session_update', {
                    session_id: payload.session_id,
                    messages,
                })
                log.info(
                    { session_id: payload.session_id, count: messages.length },
                    'LISTEN: session_update event'
                )
            }
        } catch (err) {
            log.error({ err, channel: msg.channel }, 'LISTEN: error processing notification')
        }
    })

    listenerClient.on('error', (err) => {
        log.error({ err }, 'LISTEN: connection error, reconnecting...')
        listenerClient = null
        setTimeout(() => initPgListener(io, connectionString), 1000)
    })

    log.info('LISTEN: connected to PostgreSQL, listening on [hook, session_update]')
}
```

### 7.7 `server/index.ts` — Remove `/api/emit`, Add LISTEN Init

```typescript
// Remove this endpoint:
// fastify.post('/api/emit', ...)

// Add at startup (after server starts listening):
import { initPgListener } from './listen'
await initPgListener(io, env.DATABASE_URL)
```

### 7.8 Route Handlers — Async Conversion

All route handlers in `server/routes/sessions.ts`, `server/routes/terminals.ts`, `server/routes/settings.ts` need to `await` DB calls since they change from sync to async:

```typescript
// Before:
fastify.get('/api/sessions', () => getAllSessions())

// After:
fastify.get('/api/sessions', async () => await getAllSessions())
```

### 7.9 PostgreSQL JSON Handling

**SQLite:** `tools` and `images` are stored as JSON strings, parsed with `JSON.parse()` on read.
**PostgreSQL:** `JSONB` columns return native JavaScript objects — no `JSON.parse()` needed.

The `JSON.parse(m.tools)` and `JSON.parse(m.images)` calls in `getSessionMessages()` must be removed. Also, `JSON.stringify()` when writing tools/images is not needed — `pg` automatically serializes objects to JSONB.

However, the Python side passes `json.dumps(tool_json)` as a string. With psycopg2 and JSONB columns, we should pass the Python dict directly and let psycopg2 handle serialization via `psycopg2.extras.Json`:

```python
from psycopg2.extras import Json

# When inserting tools:
cur.execute('INSERT INTO messages (..., tools, ...) VALUES (..., %s, ...)',
            (..., Json(tool_json) if tool_json else None, ...))
```

---

## 8. run.sh Changes

### 8.1 Updated `run.sh`

The startup script needs to:
1. Check PostgreSQL is available
2. Create the database if it doesn't exist
3. Run the schema migration (CREATE TABLE IF NOT EXISTS)

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --rebuild) REBUILD=true; shift ;;
        *) echo "Unknown option: $1"; echo "Usage: ./run.sh [--rebuild]"; exit 1 ;;
    esac
done

echo "WorkIO"
echo ""

# Load environment variables
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi
if [[ -f "$SCRIPT_DIR/.env.local" ]]; then
    set -a; source "$SCRIPT_DIR/.env.local"; set +a
fi

# Default DATABASE_URL if not set
DATABASE_URL="${DATABASE_URL:-postgresql://localhost/workio}"

# ---- Dependency checks ----

# Check for Python 3.10+
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not installed."
    exit 1
fi
PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
if [[ $PYTHON_MAJOR -lt 3 ]] || [[ $PYTHON_MAJOR -eq 3 && $PYTHON_MINOR -lt 10 ]]; then
    echo "Error: Python 3.10+ is required (found $PYTHON_VERSION)"
    exit 1
fi

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo "Error: Claude CLI is required but not installed."
    echo "Install it from https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed."
    exit 1
fi

# Check for PostgreSQL (psql)
if ! command -v psql &> /dev/null; then
    echo "Error: PostgreSQL client (psql) is required but not installed."
    echo "Install it with: brew install postgresql (macOS) or apt-get install postgresql-client (Linux)"
    exit 1
fi

# Load and use nvm
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
    echo "Using nvm to switch to correct Node version..."
    cd "$SCRIPT_DIR/app"
    nvm use
    cd "$SCRIPT_DIR"
fi

# Check Node.js version matches .nvmrc
NVMRC_FILE="$SCRIPT_DIR/app/.nvmrc"
if [[ -f "$NVMRC_FILE" ]]; then
    REQUIRED_NODE_VERSION=$(cat "$NVMRC_FILE" | tr -d '[:space:]')
    CURRENT_NODE_VERSION=$(node -v | sed 's/^v//')
    if [[ "$CURRENT_NODE_VERSION" != "$REQUIRED_NODE_VERSION" ]]; then
        echo "Error: Node.js version mismatch."
        echo "  Required: $REQUIRED_NODE_VERSION (from app/.nvmrc)"
        echo "  Current:  $CURRENT_NODE_VERSION"
        exit 1
    fi
fi

# ---- PostgreSQL Setup ----

# Extract database name from DATABASE_URL
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*\/([^?]*).*|\1|')

echo "Setting up PostgreSQL database: $DB_NAME"

# Create database if it doesn't exist
if ! psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null; then
    echo "Creating database $DB_NAME..."
    # Connect to 'postgres' default database to create our database
    BASE_URL=$(echo "$DATABASE_URL" | sed -E "s|/[^/?]*(\?.*)?$|/postgres\1|")
    psql "$BASE_URL" -c "CREATE DATABASE $DB_NAME" 2>/dev/null || true
fi

# Run schema migration (all CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)
echo "Running schema migration..."
psql "$DATABASE_URL" -f "$SCRIPT_DIR/schema.sql"

# ---- Python Setup ----

# Install Python dependencies if needed
if ! python3 -c "import psycopg2" 2>/dev/null; then
    echo "Installing Python dependencies..."
    python3 -m pip install -q python-dotenv psycopg2-binary
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/monitor.py"
chmod +x "$SCRIPT_DIR/setup_hooks.py"

# Update Claude hooks
echo "Updating Claude hooks..."
python3 "$SCRIPT_DIR/setup_hooks.py"

# ---- Build & Start ----

# Build webapp if not built or --rebuild flag
if [[ ! -d "$SCRIPT_DIR/app/dist" ]] || [[ "$REBUILD" == true ]]; then
    echo "Building webapp..."
    cd "$SCRIPT_DIR/app"
    npm install
    npm run build
    cd "$SCRIPT_DIR"
fi

# Start the server
echo "Starting server..."
cd "$SCRIPT_DIR/app"
npm start
```

### 8.2 Key run.sh Changes

| Before | After |
|--------|-------|
| No DB setup (SQLite auto-creates) | Check for psql, create DB if missing, run schema.sql |
| `pip install requests` | `pip install psycopg2-binary` |
| Check `import dotenv` | Check `import psycopg2` |
| `DB_NAME` env var | `DATABASE_URL` env var |

### 8.3 Environment Configuration

`.env` file:
```env
# Before:
DB_NAME=data.db
SERVER_PORT=5176
CLIENT_PORT=5175

# After:
DATABASE_URL=postgresql://localhost/workio
SERVER_PORT=5176
CLIENT_PORT=5175
```

---

## 9. Files Changed

### Modified Files

| File | Changes |
|------|---------|
| `schema.sql` | Rewrite for PostgreSQL syntax (types, triggers, indexes) |
| `db.py` | Replace `sqlite3` with `psycopg2`, `?` → `%s`, add `notify()`, use `RETURNING`, RealDictCursor |
| `monitor.py` | Remove `start_socket_worker()`, add `notify(conn, "hook", ...)` call |
| `worker.py` | Remove `emit_event()` import/call, add `notify(conn, "session_update", ...)` |
| `cleanup_worker.py` | Update datetime functions, `?` → `%s` placeholders |
| `run.sh` | Add PostgreSQL checks, DB creation, schema migration, update pip packages |
| `app/server/env.ts` | Replace `DB_NAME` with `DATABASE_URL`, remove `DB_PATH` |
| `app/server/db.ts` | Replace `better-sqlite3` with `pg` Pool, all functions async, `$N` params, remove JSON.parse for JSONB |
| `app/server/index.ts` | Remove `POST /api/emit`, add `initPgListener()` call |
| `app/server/routes/sessions.ts` | `await` all DB calls |
| `app/server/routes/terminals.ts` | `await` all DB calls |
| `app/server/routes/settings.ts` | `await` all DB calls |
| `app/package.json` | Remove `better-sqlite3`, add `pg` + `@types/pg` |
| `.env` / `.env.example` | `DATABASE_URL` instead of `DB_NAME` |

### New Files

| File | Purpose |
|------|---------|
| `app/server/listen.ts` | PostgreSQL LISTEN handler, bridges NOTIFY → Socket.IO |

### Deleted Files

| File | Reason |
|------|--------|
| `socket_worker.py` | Replaced by `pg_notify()` |
| `socket_queue/` directory | No longer needed (was used for file-based locking in socket_worker) |
| `data.db` | SQLite database file no longer used |

---

## 10. Migration Sequence

### Phase 1: Schema & Database Layer

1. Rewrite `schema.sql` for PostgreSQL
2. Rewrite `db.py` — replace `sqlite3` with `psycopg2`, add `notify()` helper
3. Add `DATABASE_URL` env var to `.env`

### Phase 2: Python — Eliminate socket_worker

4. Update `monitor.py` — remove `start_socket_worker()`, add `notify(conn, "hook", ...)`
5. Update `worker.py` — remove `emit_event()`, add `notify(conn, "session_update", ...)`
6. Update `cleanup_worker.py` — PostgreSQL query syntax
7. Delete `socket_worker.py`

### Phase 3: Node.js — Async DB + LISTEN

8. Replace `better-sqlite3` with `pg` in `package.json`
9. Rewrite `server/db.ts` — Pool, async functions, `$N` params, add `getMessagesByIds()`
10. Rewrite `server/env.ts` — `DATABASE_URL` instead of `DB_NAME`/`DB_PATH`
11. Create `server/listen.ts` — LISTEN handler
12. Update `server/index.ts` — remove `/api/emit`, add `initPgListener()`
13. Update all route files — `await` DB calls

### Phase 4: Startup & Config

14. Update `run.sh` — PostgreSQL checks, DB creation, schema migration
15. Update `.env` / `.env.example`
16. Run `npm run lint:fix && npm run check` to verify TypeScript compiles

### Phase 5: Verification

17. Start PostgreSQL, create database
18. Run `./run.sh` — should create tables and start server
19. Open dashboard — verify sessions load
20. Trigger a Claude hook — verify real-time updates arrive via NOTIFY/LISTEN
21. Verify session messages load correctly (JSONB → native objects)
22. Verify cleanup worker runs correctly
23. Delete `data.db` and `socket_queue/` directory
