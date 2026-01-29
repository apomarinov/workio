# Terminal Internals

Everything custom we do in the terminal layer — shell integration, escape sequence handling, Zellij detection, keyboard shortcuts, session management, and output optimization.

## Table of Contents

- [Shell Integration (OSC 133)](#shell-integration-osc-133)
- [OSC 52 Clipboard](#osc-52-clipboard)
- [Zellij Process Detection](#zellij-process-detection)
- [Custom Keyboard Shortcuts](#custom-keyboard-shortcuts)
- [Output Batching](#output-batching)
- [Session Management & Reconnection](#session-management--reconnection)
- [Git Branch Detection](#git-branch-detection)
- [Escape Sequences Reference](#escape-sequences-reference)

---

## Shell Integration (OSC 133)

We inject shell integration scripts that emit [OSC 133](https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md) escape sequences to track command lifecycle in real time.

### How it works

1. On PTY creation (local terminals only), the server sources a shell-specific script after a 100ms delay
2. The script registers hooks that emit OSC 133 sequences at prompt, command start, and command end
3. The server-side OSC parser intercepts these sequences and emits structured events
4. Events update session state, the database (`active_cmd`), and trigger process scans

### Injection (`server/pty/manager.ts`)

```
source "/path/to/zsh.sh"; printf '\033c\x1b[1;1H'
clear
```

The `\033c` (RIS — Reset to Initial State) and `\x1b[1;1H` (CUP — move cursor to 1,1) clean up any output from the sourcing. Followed by `clear` for a clean slate.

Supported shells: **zsh** (`zsh.sh`), **bash** (`bash.sh`). SSH terminals skip injection since the remote shell environment may differ.

### Shell scripts

**Zsh** (`server/pty/shell-integration/zsh.sh`):
- Uses `add-zsh-hook` to register `preexec` and `precmd` hooks
- `preexec` fires before command execution — emits `OSC 133;C;<command>`
- `precmd` fires after command completes — emits `OSC 133;D;<exit_code>` then `OSC 133;A`
- Guards against double-init with `__TERMINAL_INTEGRATION` env var

**Bash** (`server/pty/shell-integration/bash.sh`):
- Uses `trap DEBUG` for preexec (reads `$BASH_COMMAND`)
- Uses `PROMPT_COMMAND` for precmd (reads `$?`)
- Tracks `__terminal_integration_in_command` flag to avoid double-firing in pipelines

Both emit an initial `OSC 133;A` on load to mark the shell as idle.

### OSC parser (`server/pty/osc-parser.ts`)

The parser wraps the PTY data callback. It:

1. Passes **all** data through unchanged (xterm.js handles rendering)
2. Scans for `ESC]133;<type>[;<payload>]<terminator>` patterns
3. Emits structured `CommandEvent` objects to a separate callback
4. Buffers incomplete sequences (up to 50 chars at end of chunk) until the next data arrives

Supported terminators: BEL (`\x07`) and ST (`\x1b\\`).

Event types:

| Sequence | Event | Payload | Meaning |
|----------|-------|---------|---------|
| `ESC]133;A` | `prompt` | — | Shell idle, waiting for input |
| `ESC]133;C;<cmd>` | `command_start` | command text | User ran a command |
| `ESC]133;D;<n>` | `command_end` | exit code | Command finished |

### What happens on each event

- **`prompt`**: Sets `session.isIdle = true`, clears `active_cmd` in DB
- **`command_start`**: Sets `session.isIdle = false`, stores command, updates DB, triggers process scan after 200ms
- **`command_end`**: Triggers git branch detection and process scan after 200ms

---

## OSC 52 Clipboard

Programs like Zellij use [OSC 52](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands) to copy text to the system clipboard. We handle this on the client.

### How it works (`src/components/Terminal.tsx`)

A custom handler is registered on xterm.js's parser:

```
terminal.parser.registerOscHandler(52, (data) => { ... })
```

1. Skips during buffer replay (`sessionLiveRef` is false until after `ready` + write queue drain)
2. Extracts base64 payload after the selector semicolon
3. Decodes and writes to clipboard via `navigator.clipboard.writeText()`
4. If clipboard API fails (window not focused), shows a floating **Copy to clipboard** button at the cursor position
5. Button is dismissible with Escape

Size limit: 1,000,000 characters. Ignores query requests (`?` payload).

---

## Zellij Process Detection

We detect running commands inside Zellij panes to display them in the sidebar alongside direct shell commands.

### Architecture (`server/pty/process-tree.ts`)

Zellij sessions use the naming convention `terminal-<terminalId>`.

Detection steps:

1. **Find Zellij servers**: `ps -axo pid,ppid,comm` filtered for PPID=1 (daemon servers)
2. **Map server to session name**: `lsof -p <serverPid>` to read unix socket paths, extract session name from path pattern `/zellij-\d+[^\s]*/<session_name>`
3. **Get pane shells**: Direct children of the server PID (`pgrep -P` or `/proc/<pid>/task/<pid>/children` on Linux)
4. **Get running commands**: Children of each pane shell. If a pane shell has no children, it checks if the shell itself is a non-shell command (for zellij layout `command` directives)

### Ignored processes

Shells (zsh, bash, sh, fish, etc.), multiplexers (zellij, tmux, screen), system processes (login, sshd, sudo), and helpers (gitstatusd, fzf, claude, sleep).

### Polling (`server/pty/manager.ts`)

A global interval polls all sessions every **3 seconds**. Results are emitted via Socket.IO as `processes` events with source `'direct'` (from OSC 133) or `'zellij'` (from process tree).

---

## Custom Keyboard Shortcuts

### Option+Arrow word jumping (`src/components/Terminal.tsx`)

macOS Option key combinations for readline-style word navigation:

| Shortcut | Escape sequence sent | Action |
|----------|---------------------|--------|
| Option+Left | `\x1bb` (Meta-B) | Move cursor back one word |
| Option+Right | `\x1bf` (Meta-F) | Move cursor forward one word |
| Option+Backspace | `\x1b\x7f` (ESC+DEL) | Delete word backward |

Implemented via `terminal.attachCustomKeyEventHandler()`. These intercept the keydown event, send the escape sequence directly, and return `false` to prevent xterm.js default handling.

Note: `macOptionIsMeta: true` is set on the xterm.js instance for general Meta key support.

### Cmd+N terminal selection (`src/context/KeyMapContext.tsx`)

Cmd+1 through Cmd+9 selects the Nth terminal in the sidebar list. A visual indicator appears in the sidebar while Cmd is held.

### Escape to dismiss clipboard button

When the OSC 52 copy button is visible, Escape dismisses it. Handled both inside the terminal (via `attachCustomKeyEventHandler`, which also prevents sending `\x1b` to PTY) and at the window level (for when the terminal isn't focused).

---

## Output Batching

TUI apps like Zellij emit many small escape sequence chunks per screen redraw. Without batching, each chunk becomes a separate JSON WebSocket frame, flooding the client.

### How it works (`server/ws/terminal.ts`)

`createOutputBatcher(ws)` returns a callback that accumulates PTY output chunks in an array. A `setTimeout` flushes them as a single concatenated WebSocket message.

- **Batch window**: 4ms (`OUTPUT_BATCH_MS`)
- Under one display frame at 60fps, so imperceptible as added latency
- Dramatically reduces WebSocket frame count during TUI redraws

Used for both new sessions and reconnections. Buffer replay and control messages (ready, exit, error) bypass the batcher and send immediately.

---

## Session Management & Reconnection

### PTY sessions (`server/pty/manager.ts`)

Sessions are held in an in-memory `Map<number, PtySession>`. Each session stores:

- PTY backend (node-pty or SSH adapter)
- Output buffer (last **5,000** chunks)
- Current callbacks (swapped on reconnect)
- Command tracking state (`currentCommand`, `isIdle`)
- Terminal dimensions (`cols`, `rows`)

### Session lifecycle

1. **Create**: Validate cwd/SSH host, resolve shell (terminal → settings → env → fallback), spawn PTY, create OSC parser, inject shell integration, detect git branch
2. **Active**: PTY data flows through OSC parser → buffer + WebSocket callback
3. **Disconnect**: WebSocket closes → 30-minute timeout starts
4. **Reconnect**: New WebSocket attaches → timeout cancelled → buffer replayed → SIGWINCH sent → `ready` message
5. **Timeout/Destroy**: SIGTERM to process group, 100ms later SIGKILL, database updated

### Reconnection (`server/ws/terminal.ts`)

On page refresh, the client sends `init` with the same `terminalId`. The server:

1. Finds the existing session, cancels the timeout
2. Swaps the `onData`/`onExit` callbacks to the new WebSocket
3. Replays the entire output buffer (direct `sendMessage`, no batching)
4. Sends `ready`
5. Calls `resizeSession()` with the client's current dimensions — this sends **SIGWINCH** to the PTY, forcing TUI apps (Zellij, vim, etc.) to redraw

Without step 5, TUI apps show stale buffer content and don't respond to mouse/scroll.

### Client reconnection (`src/hooks/useTerminalSocket.ts`)

Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped). Max 10 attempts. On `ready`, `sessionLiveRef` is set to `true` only after xterm.js finishes processing the replay queue (via `write('', callback)`), preventing stale OSC 52 clipboard popups during replay.

### Resize debouncing

Resize events from the client are debounced at **500ms** on the server to prevent shell redraw spam during window dragging.

### Environment variables

The PTY is spawned with:

| Variable | Value |
|----------|-------|
| `TERM` | `xterm-256color` |
| `COLORTERM` | `truecolor` |
| `CLAUDE_TERMINAL_ID` | Terminal's numeric ID |

Plus all inherited parent process env vars.

---

## Git Branch Detection

After every `command_end` event, the server runs:

```bash
git rev-parse --abbrev-ref HEAD
```

in the terminal's `cwd`. If successful, the branch is stored in the database and emitted via Socket.IO (`terminal:updated`). Displayed in the sidebar with a branch icon.

Skipped for SSH terminals (would require running git on the remote).

---

## Escape Sequences Reference

### Sequences we detect (server-side)

| Sequence | Standard | Purpose |
|----------|----------|---------|
| `ESC]133;A<ST>` | OSC 133 | Shell idle / prompt start |
| `ESC]133;C;<cmd><ST>` | OSC 133 | Command started |
| `ESC]133;D;<code><ST>` | OSC 133 | Command ended |

### Sequences we handle (client-side)

| Sequence | Standard | Purpose |
|----------|----------|---------|
| `ESC]52;<sel>;<base64><ST>` | OSC 52 | Clipboard copy from program |

### Sequences we send (to PTY)

| Sequence | Standard | Purpose |
|----------|----------|---------|
| `ESC c` | RIS | Reset terminal (after shell integration injection) |
| `ESC[1;1H` | CUP | Move cursor to row 1, col 1 |
| `\x1bb` | Meta-B | Word backward (Option+Left) |
| `\x1bf` | Meta-F | Word forward (Option+Right) |
| `\x1b\x7f` | ESC+DEL | Delete word backward (Option+Backspace) |

### Sequences emitted by shell integration scripts

| Sequence | Direction | Purpose |
|----------|-----------|---------|
| `\e]133;A\e\\` | PTY → server | Prompt marker |
| `\e]133;C;<cmd>\e\\` | PTY → server | Command start with text |
| `\e]133;D;<code>\e\\` | PTY → server | Command end with exit code |

---

## File Map

| File | Role |
|------|------|
| `server/pty/manager.ts` | PTY lifecycle, session map, command events, process polling, git detection |
| `server/pty/osc-parser.ts` | OSC 133 sequence detection and event extraction |
| `server/pty/process-tree.ts` | Zellij session discovery, process tree traversal |
| `server/pty/shell-integration/zsh.sh` | Zsh hooks emitting OSC 133 |
| `server/pty/shell-integration/bash.sh` | Bash hooks emitting OSC 133 |
| `server/ws/terminal.ts` | WebSocket handler, output batching, reconnection |
| `server/ssh/ssh-pty-adapter.ts` | SSH PTY adapter (uniform `TerminalBackend` interface) |
| `src/components/Terminal.tsx` | xterm.js setup, OSC 52 handler, custom key handlers |
| `src/hooks/useTerminalSocket.ts` | Client WebSocket lifecycle, reconnection backoff |
| `src/context/KeyMapContext.tsx` | Cmd+N terminal selection shortcuts |

### Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_BUFFER_LINES` | 5,000 | `manager.ts` |
| `SESSION_TIMEOUT_MS` | 30 min | `manager.ts` |
| `OUTPUT_BATCH_MS` | 4ms | `ws/terminal.ts` |
| `RESIZE_DEBOUNCE_MS` | 500ms | `ws/terminal.ts` |
| `RECONNECT_DELAYS` | [1s, 2s, 4s, 8s, 16s] | `useTerminalSocket.ts` |
| `MAX_RECONNECT_ATTEMPTS` | 10 | `useTerminalSocket.ts` |
| Process poll interval | 3s | `manager.ts` |
| Shell injection delay | 100ms | `manager.ts` |
| Process scan delay | 200ms | `manager.ts` |
