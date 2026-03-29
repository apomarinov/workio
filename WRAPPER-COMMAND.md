# Wrapper Command & Shell Integration

## Problem

Tools like `devbox shell`, `nix develop`, `nix-shell`, `poetry shell` spawn a sub-shell. When running inside a workio terminal:

1. **`active_cmd` gets stuck** — OSC 133 fires "devbox shell" and never updates because the inner shell has no shell integration hooks
2. **Process detection stops at the wrapper** — the monitor finds `devbox` as the active process and doesn't look deeper
3. **No port/process visibility** for commands running inside the wrapper (ports still work via descendant PID walking, but processes don't show)

## Solution: Two complementary features

### 1. Per-terminal `wrapperCommand` field

Add a `wrapperCommand` field to `terminalSettings` (JSONB on the `terminals` table). When set (e.g. `"devbox shell"`), the monitor treats that process as transparent:

**Schema change** — `app/server/domains/workspace/schema/terminals.ts`:
- Add `wrapperCommand: z.string().optional()` to `terminalSettingsSchema`

**Monitor changes** — `app/server/domains/pty/monitor.ts`:
- Load `wrapperCommand` from the terminal's settings in `getProcessesForTerminal`
- When `currentCommand` matches the wrapper: find the wrapper process PID, walk its descendants via `getChildProcesses(wrapperPid)`, report those instead
- Suppress emitting `active_cmd` for the wrapper command itself in `emitShellUpdate`
- During scan: emit effective `active_cmd` based on the first real descendant found (or null if idle inside wrapper). Track last-emitted value per shell to avoid spamming every 3s
- Stale detection: check if the wrapper process is alive rather than looking for a matching child

**Process tree** — `app/server/domains/pty/services/process-tree.ts`:
- Add wrapper command names to `shouldIgnoreProcess` dynamically so they're also filtered in Zellij pane detection
- Export `isPassthroughProcess()` for the monitor to check

**UI changes**:
- `EditTerminalModal.tsx` — add a `wrapperCommand` input field
- `CreateTerminalModal.tsx` — optionally add it there too

### 2. Auto-inject shell integration into sub-shells

The inner shell spawned by devbox has no OSC 133 hooks. Fix by making shell integration auto-load in any sub-shell inside a workio terminal.

**New script** — `app/server/scripts/shell-integration/init.sh`:
```bash
[ -z "$WORKIO_TERMINAL_ID" ] && return 0 2>/dev/null
if [ -n "$ZSH_VERSION" ]; then . ~/.workio/shell-integration/zsh.sh
elif [ -n "$BASH_VERSION" ]; then . ~/.workio/shell-integration/bash.sh; fi
```
No-op outside workio (guarded by `WORKIO_TERMINAL_ID` env var which is exported and persists to child shells). The `__TERMINAL_INTEGRATION` guard in each script is a shell-local var (not exported), so it correctly prevents double-init in the outer shell but allows init in sub-shells.

**Move terminal clear out of integration scripts**:
- Remove `printf '\033c\x1b[1;1H'` and `printf '\e]133;A\e\\'` from the end of `bash.sh` and `zsh.sh`
- Move them into `worker.ts` (write them after `source "..."` / the SSH eval injection)
- This makes the scripts safe to source from rc files without clearing the screen

**Auto-inject into rc files**:
- In `writeShellIntegrationScripts()` (called on server startup), also write `init.sh` to `~/.workio/shell-integration/`
- Detect the user's shell (from PTY config or `$SHELL`)
- Check if `~/.bashrc` / `~/.zshrc` already contains the init.sh source line
- If not, append: `[ -f ~/.workio/shell-integration/init.sh ] && . ~/.workio/shell-integration/init.sh`
- For SSH: similar check on the remote host's rc file

**How the two features interact**:
- `wrapperCommand` works even without shell integration (3s scan delay for active_cmd updates)
- Shell integration in sub-shells gives instant OSC 133 updates when commands start/end inside the wrapper
- Both together = best experience
