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

        ssh -R 18765:127.0.0.1:18765 user@remote

-   This makes `127.0.0.1:18765` on the remote actually point to **your
    local machine**.

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

    enqueue(event)
    try_flush()

#### enqueue()

-   Assign UUID if missing
-   Write JSON file
-   Enforce disk cap (default ~200MB)
-   Drop oldest if necessary

#### try_flush()

-   Send oldest files first
-   POST to local ingest endpoint
-   If HTTP 200 → delete file
-   If failure → stop (connection likely down)

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

1.  Authenticate request (per-host shared token)
2.  Validate payload (max body size, rate limit)
3.  Reject events outside timestamp window (unless queued backlog)
4.  Deduplicate using deterministic key
5.  Forward to `process_event` pipeline
6.  Respond with ACK (HTTP 200)

If processing fails → return error → remote retries later.

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

### v1 Approach: App-Layer Dedupe (No Schema Migration)

Dedupe at the application layer in `process_event` before processing:

1.  **Deterministic dedupe key:** Hash of `session_id + timestamp +
    event_type` from the hook payload. This combination is unique per
    event across all hook types.
2.  **Check existing hooks table:** Before processing, look up whether
    this dedupe key already exists. If it does, return ACK without
    re-processing.
3.  **In-process lock map with short TTL:** Prevents concurrent
    duplicate deliveries from both passing the "exists?" check
    simultaneously. The lock is per-dedupe-key with a short expiry.
4.  **Transaction ordering:** check → insert hook marker → process side
    effects → commit. This ensures the dedupe check and insert are
    atomic within a single transaction.

**Known limitation:** The hooks table lookup is unindexed for the dedupe
key. Acceptable at v1 volume.

### Future: DB Unique Constraint

Add a `dedupe_key` column with a unique constraint to the hooks table.
This makes dedupe fully atomic at the DB level and removes the need for
the in-process lock map. Deferred to avoid schema migration in v1.

------------------------------------------------------------------------

## Reverse Tunnel Management

### Separate Subsystem (Not Terminal-Scoped)

The reverse tunnel manager is a **new host-scoped subsystem**, separate
from the terminal-scan-driven forwarding in `app/server/pty/manager.ts`.

Current tunnel machinery in `manager.ts` is driven by terminal/worker
lifecycle and 3-second process scans. Reusing it for reverse tunnels
would accidentally couple tunnel lifetime to terminal sessions.

The reverse tunnel must stay up as long as the SSH host is connected,
regardless of whether any terminal sessions are active on that host.

### Per-Host Tunnel Process

Each host gets a lightweight tunnel process managed by WorkIO:

    ssh -N \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=3 \
      -R 18765:127.0.0.1:18765 \
      user@remote

If it dies → restart automatically.

This tunnel is separate from your interactive PTY session.

------------------------------------------------------------------------

## Remote Bootstrap

### SCP-Based Deployment

On first SSH connect to a host, WorkIO:

1.  Checks if the remote forwarder script exists at
    `~/.workio/claude_forwarder.py`
2.  If missing or outdated version → SCP the current version
3.  Configures Claude hooks on the remote to call the forwarder

### Version Detection

The forwarder script has an embedded version string:

    FORWARDER_VERSION = "1.0.0"

On connect, WorkIO reads the remote version and compares against the
local copy. If outdated, SCP overwrites. No package manager or complex
update protocol needed.

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
-   Traffic only flows inside SSH
-   Per-host shared token validation on `/claude-hook` route
-   Timestamp window rejection (reject stale events unless queued
    backlog)
-   Rate limiting + max body size on ingest route
-   Remote cannot reach local unless SSH session exists

------------------------------------------------------------------------

## Failure Modes Covered

| Scenario | Outcome |
|---|---|
| SSH drops | Events buffered in file queue |
| Local restarts | Remote retries; in-process lock rebuilds on boot |
| Remote crash | File queue survives on disk |
| Duplicate send | Rejected via dedupe key lookup + in-process lock |
| Disk fills | Oldest events trimmed (200MB cap) |
| Concurrent duplicates | In-process lock prevents race condition |

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

-   DB unique constraint on dedupe key (removes need for in-process
    lock)
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
-   Persistent dedupe against existing hooks table
-   Clean integration with existing `process_event` pipeline

It is essentially a lightweight, SSH-backed event transport tailored to
WorkIO's architecture.
