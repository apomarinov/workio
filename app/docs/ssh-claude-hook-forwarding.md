# Remote SSH Claude Hook Forwarding

## Context

WorkIO's local Claude hook pipeline: Claude hooks → `monitor.py` (thin client) → `monitor_daemon.py` (Unix socket at `./daemon.sock`) → PostgreSQL + NOTIFY → UI updates. For SSH terminals where Claude runs on the remote host, hook events never reach local. We want a palette action to install a forwarding hook on the remote that tunnels events back to local via the existing SSH connection.

## Architecture

```
Remote SSH Host                          Local WorkIO
─────────────────                        ──────────────────
Claude hook fires
  → hook.py reads stdin
  → tries POST to 127.0.0.1:18765 ──────→ (via ssh2 forwardIn reverse tunnel)
    │                                      → Fastify POST /api/claude-hook
    │ if POST fails:                         → spawns python monitor.py
    └→ appends to ~/.workio/                   → existing daemon pipeline
       claude_events.jsonl                     → PostgreSQL + UI
       (drained on next connect)
```

**On SSH shell connect:** check if hooks installed → setup `forwardIn()` reverse tunnel → drain JSONL queue
**While connected:** real-time POST through tunnel → Fastify → monitor.py
**On disconnect:** tunnel dies, events accumulate in JSONL, drained on next connect

---

## Implementation Steps

### Step 1: Expose ssh2 Client on TerminalBackend

**File:** `app/server/ssh/ssh-pty-adapter.ts`

The `TerminalBackend` interface (line 5-14) has no reference to the ssh2 Client. The `conn` variable is local to `createSSHSession()` (line 22) and never exposed.

Add optional `conn?: Client` property to the interface and set it on the adapter object (line 39):

```typescript
// In the interface:
export interface TerminalBackend {
  readonly pid: number
  readonly conn?: Client  // SSH connection, only present for SSH backends
  write(data: string): void
  // ... rest unchanged
}

// In the adapter object inside createSSHSession():
const adapter: TerminalBackend = {
  pid: 0,
  conn,  // <-- add this
  // ... rest unchanged
}
```

Local backends (node-pty `spawn()`) don't have `conn`, so it stays `undefined` for them.

### Step 2: Create tunnel manager

**New file:** `app/server/ssh/tunnel-manager.ts`

Manages one reverse tunnel per SSH host using ssh2's `forwardIn('127.0.0.1', 18765)`.

Exports:
- `setupTunnel(sshHost, shellId, conn)` — calls `conn.forwardIn()`, registers `conn.on('tcp connection', ...)` handler that TCP-proxies to local Fastify port
- `removeTunnel(sshHost, shellId, getConnForShell)` — if this shell owned the tunnel, tries to migrate to another shell's connection via `getConnForShell()`. If none available, tunnel just dies (events queue up on remote)
- `hasTunnel(sshHost)` — check if host has active tunnel

Internal state: `Map<string, { ownerShellId: number, conn: Client, alternateShellIds: Set<number> }>`

TCP proxy pattern for `tcp connection` handler:
```typescript
conn.on('tcp connection', (info, accept, reject) => {
  const channel = accept()
  const localPort = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT
  const local = net.createConnection({ port: localPort, host: '127.0.0.1' })
  channel.pipe(local)
  local.pipe(channel)
  channel.on('error', () => local.destroy())
  local.on('error', () => channel.close())
  channel.on('close', () => local.destroy())
  local.on('close', () => channel.close())
})
```

Tunnel migration on owner shell exit:
```typescript
export function removeTunnel(
  sshHost: string,
  shellId: number,
  getConnForShell: (shellId: number) => Client | undefined
): void {
  const entry = tunnels.get(sshHost)
  if (!entry) return

  if (entry.ownerShellId !== shellId) {
    entry.alternateShellIds.delete(shellId)
    return
  }

  // Owner disconnected — try to migrate to an alternate
  for (const altShellId of entry.alternateShellIds) {
    const altConn = getConnForShell(altShellId)
    if (altConn) {
      tunnels.delete(sshHost)
      entry.alternateShellIds.delete(altShellId)
      setupTunnel(sshHost, altShellId, altConn).then(() => {
        const t = tunnels.get(sshHost)
        if (t) for (const r of entry.alternateShellIds) t.alternateShellIds.add(r)
      }).catch(() => {})
      return
    }
  }

  // No alternates — tunnel gone
  tunnels.delete(sshHost)
}
```

### Step 3: Create claude-hooks module

**New file:** `app/server/ssh/claude-hooks.ts`

#### A) Remote hook script (embedded Python string)

This gets written to `~/.workio/hook.py` on the remote host:

```python
#!/usr/bin/env python3
"""WorkIO remote Claude hook forwarder."""
import json, sys, os
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

def main():
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"continue": True}))
        return

    config_path = Path.home() / ".workio" / "config.json"
    try:
        with open(config_path) as f:
            config = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        print(json.dumps({"continue": True}))
        return

    port = config.get("port", 18765)
    ssh_host = config.get("ssh_host", "unknown")
    payload = json.dumps({"event": event, "ssh_host": ssh_host}).encode()

    try:
        req = Request(
            f"http://127.0.0.1:{port}/api/claude-hook",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp = urlopen(req, timeout=5)
        if resp.status == 200:
            print(json.dumps({"continue": True}))
            return
    except (URLError, OSError):
        pass

    # POST failed — queue for later drain
    queue_path = Path.home() / ".workio" / "claude_events.jsonl"
    try:
        with open(queue_path, "a") as f:
            f.write(json.dumps({"event": event, "ssh_host": ssh_host}) + "\n")
    except OSError:
        pass

    print(json.dumps({"continue": True}))

if __name__ == "__main__":
    main()
```

Only uses Python stdlib — no pip dependencies needed on remote.

#### B) `installClaudeHooks(sshHost: string)`

Uses `execSSHCommand` (from `app/server/ssh/exec.ts`) for all remote operations:

1. `mkdir -p ~/.workio`
2. Write `hook.py` via heredoc: `cat > ~/.workio/hook.py << 'WORKIO_HOOK_EOF'\n...\nWORKIO_HOOK_EOF`
3. `chmod +x ~/.workio/hook.py`
4. Write `config.json`: `{ "port": 18765, "ssh_host": "<alias>" }`
5. Read remote `~/.claude/settings.json` (or `{}` if absent)
6. Add hook entries — same 7 types as local `setup_hooks.py` (line 18-26):
   - `SessionStart`, `UserPromptSubmit` (no matcher)
   - `PreToolUse`, `PostToolUse`, `Notification` (matcher: `"*"`)
   - `Stop`, `SessionEnd` (no matcher)
   - Hook command: `$HOME/.workio/hook.py`
   - Check for existing entries before adding (same logic as `setup_hooks.py` line 44-55)
7. Write settings back: `mkdir -p ~/.claude && cat > ~/.claude/settings.json << 'EOF'\n...\nEOF`

#### C) `checkHooksInstalled(sshHost: string): Promise<boolean>`

```typescript
const result = await execSSHCommand(sshHost, 'test -f ~/.workio/hook.py && echo "yes" || echo "no"')
return result.stdout.trim() === 'yes'
```

#### D) `handleClaudeHookEvent(event, sshHost)`

Event processing with sequential-per-session, parallel-across-sessions guarantee:

```typescript
const sessionQueues = new Map<string, Promise<void>>()

export async function handleClaudeHookEvent(event: Record<string, unknown>, sshHost: string): Promise<void> {
  const terminalId = await resolveTerminalId(sshHost)  // looks up via getAllTerminals()
  if (terminalId === null) return

  const sessionId = (event.session_id as string) || 'unknown'
  const prev = sessionQueues.get(sessionId) ?? Promise.resolve()
  const next = prev.then(() => spawnMonitor(event, terminalId)).catch(() => {})
  sessionQueues.set(sessionId, next)
  next.finally(() => {
    if (sessionQueues.get(sessionId) === next) sessionQueues.delete(sessionId)
  })
  return next
}
```

`spawnMonitor` spawns `python3 monitor.py` with:
- Event JSON piped to stdin (same format Claude sends to hooks)
- `WORKIO_TERMINAL_ID` env var set to the resolved terminal ID
- `monitor.py` (at repo root) wraps with `{ event, env: { WORKIO_TERMINAL_ID } }` and sends to daemon socket

#### E) `drainEventQueue(sshHost: string)`

1. Atomic rotate: `mv ~/.workio/claude_events.jsonl ~/.workio/claude_events.drain && touch ~/.workio/claude_events.jsonl`
   - New events from hooks after this point go to the fresh file
2. Read drain file: `cat ~/.workio/claude_events.drain` via `execSSHCommand`
3. Parse each JSON line, process through `handleClaudeHookEvent`
4. Delete: `rm -f ~/.workio/claude_events.drain`

### Step 4: Add Fastify endpoints

**File:** `app/server/index.ts`

**`POST /api/claude-hook`** — receives `{ event, ssh_host }`, calls `handleClaudeHookEvent()` fire-and-forget, responds 200 immediately.

**`POST /api/terminals/:id/install-claude-hooks`** — validates terminal is SSH, calls `installClaudeHooks(terminal.ssh_host)`, returns success/error.

Pattern matches existing endpoints like `POST /api/webhooks/github` (line 572) and `POST /api/notifications/mark-all-read` (line 693).

### Step 5: Wire into PTY manager

**File:** `app/server/pty/manager.ts`

**On SSH session create** — after `backend = await createSSHSession(result.config, cols, rows)` (line 962):
```typescript
if (backend.conn && terminal.ssh_host) {
  checkHooksInstalled(terminal.ssh_host).then(async (installed) => {
    if (installed && backend.conn) {
      await setupTunnel(terminal.ssh_host!, shellId, backend.conn)
      drainEventQueue(terminal.ssh_host!).catch(() => {})
    }
  }).catch(() => {})
}
```
This is fire-and-forget — doesn't block shell readiness.

**On SSH session exit** — in the `backend.onExit` handler (line 1126), before `sessions.delete(shellId)`:
```typescript
if (terminal.ssh_host) {
  removeTunnel(terminal.ssh_host, shellId, (sid) => {
    const s = sessions.get(sid)
    return s?.pty.conn
  })
}
```

### Step 6: Add palette action

**File:** `app/src/components/CommandPalette/modes/actions.tsx`

Add "Install Claude Hooks" item inside the `if (terminal)` block, gated by `terminal.ssh_host`. Place after "Reveal in Finder" (line 188), before "Edit" (line 191):

```tsx
if (terminal.ssh_host) {
  items.push({
    id: 'action:install-claude-hooks',
    label: 'Install Claude Hooks',
    icon: <Zap className="h-4 w-4 shrink-0 text-zinc-400" />,
    onSelect: async () => {
      api.close()
      try {
        const res = await fetch(`/api/terminals/${terminal.id}/install-claude-hooks`, { method: 'POST' })
        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error || 'Failed to install hooks')
        } else {
          toast.success('Claude hooks installed')
        }
      } catch {
        toast.error('Failed to install hooks')
      }
    },
  })
}
```

Add `Zap` to the lucide-react imports (line 1).

---

## Existing Code Reference

### Key files and what they do

| File | Role |
|------|------|
| `monitor.py` | Thin client: reads event JSON from stdin, wraps with `WORKIO_TERMINAL_ID` env var, sends to daemon via Unix socket |
| `monitor_daemon.py` | Persistent daemon: processes events, writes to PostgreSQL, emits NOTIFY, spawns debounced workers |
| `setup_hooks.py` | Registers hooks in `~/.claude/settings.json` (7 hook types, matcher patterns) |
| `app/server/ssh/ssh-pty-adapter.ts` | Creates ssh2 Client + interactive shell, wraps in `TerminalBackend` interface |
| `app/server/ssh/exec.ts` | One-off SSH command execution via new ssh2 Client (15s default timeout) |
| `app/server/ssh/config.ts` | Reads `~/.ssh/config`, validates SSH hosts |
| `app/server/pty/manager.ts` | PTY session lifecycle, shell creation/exit, process polling |
| `app/server/index.ts` | Fastify server setup, route registration, daemon process management |
| `app/src/components/CommandPalette/modes/actions.tsx` | Terminal/session action items in command palette |

### How `monitor.py` wraps events (line 27-32)

```python
message = json.dumps({
    "event": event,                              # raw Claude hook event
    "env": {
        "WORKIO_TERMINAL_ID": os.environ.get("WORKIO_TERMINAL_ID", ""),
    }
})
```

### How `monitor_daemon.py` uses terminal_id (line 184-185)

```python
terminal_id_str = env.get('WORKIO_TERMINAL_ID')
terminal_id = int(terminal_id_str) if terminal_id_str else None
```

### WORKIO_TERMINAL_ID is only set for local terminals (manager.ts line 1029)

```typescript
backend = pty.spawn(shell, [], {
  env: {
    ...process.env,
    WORKIO_TERMINAL_ID: String(terminalId),  // <-- only in local spawn
  },
})
```

SSH terminals skip this entirely (line 962 just calls `createSSHSession`). For remote hooks, the Fastify endpoint resolves `terminal_id` from `ssh_host` via DB lookup and passes it as an env var when spawning `monitor.py`.

### Hook definitions (setup_hooks.py line 18-26)

```python
HOOK_DEFINITIONS = {
    "SessionStart": {"needs_matcher": False},
    "UserPromptSubmit": {"needs_matcher": False},
    "PreToolUse": {"needs_matcher": True, "matcher": "*"},
    "PostToolUse": {"needs_matcher": True, "matcher": "*"},
    "Notification": {"needs_matcher": True, "matcher": "*"},
    "Stop": {"needs_matcher": False},
    "SessionEnd": {"needs_matcher": False},
}
```

### Palette action pattern (actions.tsx)

SSH-only actions gated by `if (terminal.ssh_host)`, local-only by `if (!terminal.ssh_host)`. Items pushed to `items[]` array with `{ id, label, icon, onSelect }`. Use `toast` from `@/components/ui/sonner` for feedback.

### Fastify server port (env.ts)

```typescript
SERVER_PORT: z.coerce.number().default(5176),  // dev
CLIENT_PORT: z.coerce.number().default(5175),  // prod
```

Server listens on `CLIENT_PORT` in production, `SERVER_PORT` in development (index.ts line ~806).

---

## Design Decisions

- **POST-first, JSONL-fallback**: Hook tries POST, only writes to JSONL on failure. Events go through one path, never both. Rare edge case of double processing (POST succeeds but response lost) is benign — daemon `upsert_session` is idempotent.
- **`forwardIn()` on existing ssh2 connection**: No separate tunnel process to manage. Tunnel lifecycle tied to shell connection, with migration between shells on same host.
- **Fixed port 18765**: Simplifies config. If port in use on remote, `forwardIn` fails gracefully and hooks fall back to JSONL queuing.
- **Spawn `monitor.py`** rather than reimplementing in Node: Reuses entire existing pipeline (daemon, worker, DB logic). Fastify endpoint is just a thin proxy.
- **Per-session promise queue**: Events for the same `session_id` processed sequentially (order matters for session state machine). Different sessions processed in parallel.
- **Atomic file rotation for drain**: `mv events.jsonl events.drain` is atomic. New events during drain go to fresh file. No data loss, no race condition.

## Verification

1. Install hooks on SSH host via palette action
2. Verify remote files: `~/.workio/hook.py`, `~/.workio/config.json`, `~/.claude/settings.json`
3. Run Claude on remote, verify sessions appear in local WorkIO UI
4. Disconnect terminal, run Claude on remote (events queue in JSONL)
5. Reconnect terminal, verify queued events drain and appear in UI
6. Test with multiple shells to same SSH host (tunnel sharing + migration)
7. Test parallel Claude sessions (sequential per session, parallel across)
