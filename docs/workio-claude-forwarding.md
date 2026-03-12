# WorkIO -- Remote Claude Hook Forwarding Design

## Goal

Make Claude Code sessions running on **remote SSH hosts** visible inside
the **local WorkIO web app** (xterm + node-pty + local Python
processing), with:

-   Near-realtime delivery when connected
-   Durable buffering when disconnected
-   No inbound connectivity to local machine (local → remote only
    allowed)
-   Safe retry + acknowledgement semantics
-   Simple deployment (no external infra)

------------------------------------------------------------------------

## Final Architecture (Chosen Approach)

We use a **Store → Forward → ACK** model over an **SSH reverse tunnel**
initiated from the local machine.

    Local WorkIO ──SSH -R──▶ Remote Host
         ▲                         │
         │                         │
    HTTP ingest <────POST──────────┘
         │
    Local Python processing (monitor_daemon.py → process_event)

### Key Idea

Even though only **local → remote SSH is allowed**, we can still get
remote → local data flow by:

-   Opening a persistent SSH connection:

        ssh -R 18765:127.0.0.1:<SERVER_PORT> <host-alias>

-   This makes `127.0.0.1:18765` on the remote actually point to **your
    local WorkIO server** (e.g. port 5176 in dev).

Remote scripts can now safely POST events to:

    http://127.0.0.1:18765/claude-hook

This behaves like a realtime push channel without exposing your local
machine.

------------------------------------------------------------------------

## Reliability Model

Remote never sends events directly.

Instead it:

1.  **Writes event to a local durable queue**
2.  Attempts delivery to local
3.  Deletes only after receiving ACK

This guarantees:

-   No data loss
-   Safe reconnect behavior
-   At-least-once delivery (deduped locally)

------------------------------------------------------------------------

## Remote Side Design

### Queue Location

    ~/.workio/claude_queue/
        <event-id>.json

Each file = exactly one event.

This is intentional:

-   Atomic
-   Crash-safe
-   Easy to delete after ACK
-   No corruption risk like large log files

------------------------------------------------------------------------

### Remote Forwarder Behavior

The forwarder is a **single self-contained Python script** deployed via
SCP on first SSH connect. It includes an embedded version marker for
update detection (see Remote Bootstrap below).

For each Claude hook:

    enrich(event)
    enqueue(event)
    try_flush()

#### enrich()

The forwarder enriches the hook event **on the remote** before
enqueueing, because the remote has access to files that the local
machine doesn't:

1.  **Resolve project path** — same logic as `resolve_project_path()`
    in `monitor_daemon.py`: read `~/.claude.json`, match the encoded
    dir from `transcript_path` to the real project path. Overwrite
    `cwd` in the event with the resolved path. This way the local
    pipeline receives a correct `cwd` without needing to resolve it.

2.  **Transcript delta** — track a byte offset per session transcript
    file. On each hook, read from last offset to EOF, include the new
    JSONL lines in the payload as `transcript_delta`. Hooks fire
    frequently (every tool use, every prompt), so deltas are typically
    a few KB.

3.  **Session index entry** — read the relevant entry from
    `~/.claude/projects/{encoded_path}/sessions-index.json` and
    include it as `session_index`. This is tiny (name, message count).

4.  **Host alias** — read from `~/.workio/config.json` (written by
    bootstrap). Included in every payload so the local side knows
    which SSH host the event came from.

Enriched payload structure:

    {
      "event": { ...original hook with corrected cwd... },
      "host_alias": "dev-server",
      "transcript_delta": "...new JSONL lines since last hook...",
      "transcript_offset": 48230,
      "session_index": { "name": "...", "message_count": 12 }
    }

#### enqueue()

-   Assign UUID if missing
-   Write enriched JSON file to queue
-   Enforce disk cap (default ~200MB)
-   Drop oldest if necessary

#### try_flush()

-   Send oldest files first
-   POST to local ingest endpoint
-   If HTTP 200 → delete file
-   If failure → stop (connection likely down)

------------------------------------------------------------------------

### Transcript Mirroring (Local Side)

The `/claude-hook` route extracts `transcript_delta` from the payload
and appends it to a local mirror file:

    ~/.workio/mirrors/<host-alias>/<session_id>.jsonl

It then rewrites `transcript_path` in the event to point at the mirror
before forwarding to the daemon. This way:

-   `process_transcript()` in `worker.py` reads the mirror file —
    no change needed
-   `read_last_assistant_message()` reads the mirror file —
    no change needed
-   `session_index` from the payload is used directly instead of
    looking up the local `~/.claude` index

------------------------------------------------------------------------

### Why File-per-Event Instead of JSONL?

Because this is **much safer** when:

-   network drops mid-send
-   process crashes
-   multiple producers run

This behaves like a tiny message queue.

------------------------------------------------------------------------

## Local Side Design

### Ingest Route

A new **Fastify route on the existing WorkIO server** (`app/server/`):

    POST /claude-hook

This reuses the existing server process — no separate daemon. The route
feeds directly into the existing `process_event` path in
`monitor_daemon.py` (started from `app/server/index.ts`), ensuring
remote hooks go through the same pipeline as local hooks.

**Do not create a parallel processing pipeline.** The existing
`monitor.py` → `monitor_daemon.py` path via Unix socket is the canonical
hook processor. The HTTP route is just a new entry point into the same
pipeline.

Responsibilities:

1.  Validate payload (max body size, rate limit)
2.  Reject events outside timestamp window (unless queued backlog)
3.  Deduplicate using deterministic key
4.  Forward to `process_event` pipeline
5.  Respond with ACK (HTTP 200)

If processing fails → return error → remote retries later.

### Remote-Specific Local Behavior

#### Branch Detection

`detectSessionBranch()` in `app/server/listen.ts` already handles SSH
terminals — when `terminal.ssh_host` is set, it runs `git rev-parse`
on the remote via `execSSHCommand`. This works for remote hooks as
long as `WORKIO_TERMINAL_ID` is forwarded in the payload.

If a remote hook arrives **without a `terminal_id`**, the fallback
tries to run `git` locally with the remote project path, which fails.
For remote hooks without `terminal_id`: skip branch detection entirely.

#### Project Identity

`upsert_project()` currently uses `path TEXT UNIQUE` to identify
projects. This breaks across hosts — `/Users/apo/code/project` (local)
and `/home/user/project` (remote) are different paths but may be the
same codebase.

Add `host` column to the projects table. Unique key becomes
`(host, path)`:

    CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        host VARCHAR(255) NOT NULL DEFAULT 'local',
        path TEXT,
        UNIQUE(host, path)
    );

-   Local projects: `host = 'local'`
-   Remote projects: `host = '<host-alias>'` (from forwarder payload)
-   `upsert_project()` updated to accept `host` parameter

------------------------------------------------------------------------

## Deduplication Strategy

### Why Dedupe Matters

Duplicate events are not harmless. Specific side effects in the current
pipeline:

-   `save_hook()` in `db.py` inserts duplicate hook rows
-   `create_prompt()` in `db.py` creates duplicate prompts on
    `UserPromptSubmit`
-   `start_debounced_worker()` spawns extra cleanup workers
-   `notify("hook", ...)` sends duplicate UI/event-stream notifications

### Approach: Unique Constraint on Hooks Table

Add a `dedupe_key` column with a `UNIQUE` constraint to the hooks
table:

    CREATE TABLE IF NOT EXISTS hooks (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100),
        hook_type VARCHAR(30),
        payload JSONB,
        dedupe_key VARCHAR(128) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

**Key computation:** `hash(session_id + hook_type + event_timestamp)`
where `event_timestamp` comes from the hook payload. This combination
is unique per event across all hook types.

**Insert behavior:** `save_hook()` computes the dedupe key and inserts
with it. If the unique constraint is violated → duplicate, return ACK
without processing.

This is fully atomic at the DB level. No in-memory state, no lock
maps, survives server restarts. No migration needed — just update
`schema.sql` directly.

------------------------------------------------------------------------

## Bootstrap & Tunnel Management

### Single Bootstrap Function Per Host

One function: `bootstrapRemoteHost(hostAlias)`. Called from
`app/server/pty/session-proxy.ts` after the SSH worker is ready and
the terminal is updated (~line 484), alongside the existing
fire-and-forget SSH setup (name file writes). The call site:

    // session-proxy.ts, after worker ready + terminal update
    if (terminal.ssh_host) {
      bootstrapRemoteHost(terminal.ssh_host)  // no-ops if already setup/done
      // ...existing name file writes...
    }

The bootstrap function and its in-memory state map live in their own
module (e.g. `app/server/ssh/claude-forwarding.ts`), imported by
`session-proxy.ts`. Fire-and-forget — does not block the shell session.

### In-Memory Server State

    Map<hostAlias, { status: 'setup' | 'done', tunnel?: ChildProcess }>

-   **`setup`** — bootstrap is running. Additional client connections
    to the same host are ignored (no-op).
-   **`done`** — bootstrap completed, tunnel is running.
-   **No entry** — host has never been bootstrapped this server
    session. First client connection triggers it.

### Bootstrap Flow

After a client's SSH shell is successfully established, if the host
has no entry in the state map:

    bootstrapRemoteHost(hostAlias):

      1. Set status → 'setup'

      2. Check if ~/.claude/settings.json exists on remote
         - If not → early return (Claude not installed, remove entry)
         - If yes → continue

      3. Write host config to remote
         - Write ~/.workio/config.json with { "host_alias": "<host-alias>" }
         - The forwarder reads this and includes host_alias in every
           hook payload, so the local side can identify which SSH host
           the event came from (needed for project identity)

      4. Setup hooks on remote
         - Read remote ~/.claude/settings.json
         - Merge workio forwarder hooks (append-if-missing, same logic
           as setup_hooks.py)
         - All 7 event types: SessionStart, UserPromptSubmit,
           PreToolUse (*), PostToolUse (*), Notification (*), Stop,
           SessionEnd
         - Command = absolute path: $HOME/.workio/claude_forwarder.py
           (resolve $HOME on remote)
         - Write back merged settings.json

      5. Copy forwarder to remote
         - SCP claude_forwarder.py → ~/.workio/claude_forwarder.py
         - Version check: read embedded FORWARDER_VERSION from remote,
           compare to local copy. SCP if missing or outdated.
         - chmod +x

      5b. Install wio Claude skill on remote
         - SCP claude-skill/wio/SKILL.md → ~/.claude/skills/wio/SKILL.md
         - Same as run.sh does locally: mkdir -p ~/.claude/skills/wio,
           then copy SKILL.md

      6. Start reverse tunnel
         - ssh -N \
             -o ExitOnForwardFailure=yes \
             -o ServerAliveInterval=15 \
             -o ServerAliveCountMax=3 \
             -R 18765:127.0.0.1:<SERVER_PORT> \
             <host-alias>
         - Store ChildProcess reference in state
         - On tunnel exit → restart automatically (unless server is
           shutting down)

      7. Set status → 'done'

### Concurrency Guard

If `status === 'setup'` when another client connects to the same
host → skip. The first connection handles it.

### Server Shutdown

On server kill / graceful shutdown:

-   Iterate all entries in the host state map
-   Kill every tunnel `ChildProcess`
-   Clear state

### Why Re-Bootstrap Every Session

The bootstrap runs the full sequence each server start (no persistent
state across restarts). This keeps it simple:

-   Hooks may have been removed on the remote
-   Forwarder may have been updated locally
-   Tunnel process doesn't survive server restart anyway

### Notes

-   The tunnel is a separate SSH connection from the interactive PTY
    session — it uses `ssh -N` (no shell)
-   The tunnel is host-scoped, not terminal/shell-scoped. One tunnel
    per host regardless of how many shells are open
-   Forwarder command path stays the same across version updates, so
    hooks survive SCP overwrites
-   Bootstrap should verify `python3` 3.10+ exists on remote before
    step 3 (forwarder may use union type hints like `str | None`)

------------------------------------------------------------------------

## Realtime Behavior

When tunnel is up:

-   Event latency = HTTP latency (milliseconds)

When tunnel is down:

-   Events accumulate safely in file queue
-   Flush automatically on reconnect

------------------------------------------------------------------------

## Optional Catch-up Accelerator

A small background loop on remote can periodically retry flush so
backlog drains immediately after reconnect.

Not required but improves recovery speed.

------------------------------------------------------------------------

## Security Properties

-   No inbound ports opened
-   Traffic only flows inside SSH tunnel (already authenticated)
-   No additional tokens needed — only processes on the remote's
    localhost can reach the tunnel port
-   Timestamp window rejection (reject stale events unless queued
    backlog)
-   Rate limiting + max body size on ingest route
-   Remote cannot reach local unless SSH session exists

------------------------------------------------------------------------

## Failure Modes Covered

| Scenario | Outcome |
|---|---|
| SSH drops | Events buffered in file queue |
| Local restarts | Remote retries; dedupe key prevents reprocessing |
| Remote crash | File queue survives on disk |
| Duplicate send | Rejected via dedupe key lookup + in-process lock |
| Disk fills | Oldest events trimmed (200MB cap) |
| Concurrent duplicates | DB unique constraint rejects at insert |

------------------------------------------------------------------------

## Why This Approach Fits WorkIO

This integrates cleanly with your existing model:

-   You already manage SSH hosts
-   You already have a local Node + Python processing pipeline
    (`monitor_daemon.py`)
-   Hooks already enter via Unix socket from `monitor.py` — the HTTP
    route is just a new entry point into the same path
-   SSH terminals already export `WORKIO_TERMINAL_ID` /
    `WORKIO_SHELL_ID`, so remote hooks preserve terminal identity
-   You want visibility into remote Claude sessions without deploying
    infra
-   You want something operationally simple, not Kafka-in-a-box

This solution behaves like a purpose-built telemetry relay.

------------------------------------------------------------------------

## Future Extensions

-   Compression (gzip over tunnel)
-   Unified agent for processes/ports/Claude telemetry
-   Batched Python processing

------------------------------------------------------------------------

## Summary

This design gives you:

-   Realtime remote Claude visibility
-   Offline-safe buffering
-   No network exposure
-   Minimal moving parts
-   Easy deployment (one Python file + SSH tunnel)
-   DB-level dedupe via unique constraint on hooks table
-   Clean integration with existing `process_event` pipeline

It is essentially a lightweight, SSH-backed event transport tailored to
WorkIO's architecture.
