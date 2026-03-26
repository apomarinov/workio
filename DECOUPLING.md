# Domain Decoupling Plan

Audit of logic that lives in the wrong domain, with concrete move targets.

## Overview

The codebase has 8 server domains. Two are clean (`settings`, `logs` — no cross-domain imports). The rest have varying degrees of misplaced logic. This document covers each piece of misplaced logic, why it's wrong, and where it should go.

**Scope**: Moving logic to the correct owning domain. Event patterns and pub/sub restructuring are out of scope — that's a separate pass after decoupling.

---

## 1. Git Status Logic in PTY Monitor ✅ Done (Option A)

**Problem**: `pty/monitor.ts` contains ~400 lines of pure git logic — branch detection, dirty status, remote sync, last commit, repo slug detection, and the polling infrastructure for all of it. None of this is a PTY concern.

### Pure git functions to extract

These functions are pure git logic with no PTY concerns. They move regardless of which option is chosen.

| Function | Lines | What it does |
|----------|-------|--------------|
| `checkGitDirty()` | 864-965 | `git diff --numstat` + `git ls-files --others` (local + SSH) |
| `checkGitRemoteSync()` | 967-1039 | `git rev-list --count HEAD..@{u}` (local + SSH) |
| `countRemoteSync()` | 1041-1087 | Helper for checkGitRemoteSync |
| `checkLastCommit()` | 818-862 | `git log -1 --format="%H%n%an%n%aI%n%s"` (local + SSH) |
| `detectRepoSlug()` | 1089-1124 | `git remote get-url origin` → regex parse (see also item 3) |
| `parseDiffNumstat()` | 801-811 | Parse `git diff --numstat` output |
| `countUntracked()` | 813-816 | Count untracked file lines |

**Move to**: New file `git/services/status.ts`

### Class methods and orchestration

`TerminalMonitor.detectGitBranch()` (lines 144-212) does 3 things:
1. **Detects branch** via `git rev-parse --abbrev-ref HEAD` — git concern
2. **Writes to workspace DB** via `updateTerminal(id, { git_branch })` — workspace concern
3. **Detects repo slug** via `detectRepoSlug()` and writes `git_repo` to workspace DB — git+workspace concern

The branch detection already exists in `git/services/branch-detection.ts:detectBranch()` as a near-duplicate. The pty monitor should not have its own copy.

`TerminalMonitor.checkAndEmitGitDirty()` (lines 92-142) calls the pure git functions, stores results per terminal, diffs old vs new, emits Socket.IO events (`git:dirty-status`, `git:remote-sync`).

### Exported wrappers

| Wrapper | Lines | Callers |
|---------|-------|---------|
| `detectGitBranch(terminalId, options?)` | 1234-1240 | git/mutations/branches.ts (6x), git/mutations/commit.ts (3x), github/polling.ts (2x), monitor.ts internal (2x) |
| `checkAndEmitSingleGitDirty(terminalId, force?)` | 1226-1232 | git/mutations/commit.ts (3x), git/mutations/branches.ts (2x) |
| `startGitDirtyPolling()` | 1216-1220 | io-handlers.ts (1x) |

### Types to move

These types in `pty/schema.ts` (lines 200-228) are git concepts:

| Type | Used by (server) | Used by (client) |
|------|------------------|-------------------|
| `GitDiffStat` | pty/monitor.ts | GitStatus.tsx, createPaletteModes.ts |
| `GitLastCommit` | pty/monitor.ts | (via ProcessContext) |
| `GitRemoteSyncStat` | pty/monitor.ts | GitStatus.tsx |
| `GitDirtyPayload` | (Socket.IO payload shape) | (via ProcessContext) |
| `GitRemoteSyncPayload` | (Socket.IO payload shape) | (via ProcessContext) |

**Move to**: `git/schema.ts`. Update all import paths. Client imports change from `@domains/pty/schema` to `@domains/git/schema`.

### Decision: Option A vs Option B

The pure functions and types move regardless. The question is where the **orchestration, per-terminal state, and polling** live.

#### Option A: Git domain owns everything (full extraction)

```
git/services/status.ts (new)
├── Per-terminal state map (lastDirty, lastRemoteSync, lastCommit per terminal)
├── Pure git functions (checkGitDirty, checkGitRemoteSync, checkLastCommit, etc.)
├── Diffing logic (compare old vs new, decide whether to emit)
├── Socket.IO emission (git:dirty-status, git:remote-sync)
├── Polling (startGitDirtyPolling → scanAndEmitGitDirty every 10s)
├── Exported: startGitDirtyPolling(), checkAndEmitSingleGitDirty(terminalId), detectGitBranch(terminalId)
```

```
pty/monitor.ts (after)
├── TerminalMonitor class — process fields only
│   └── processPollTimeout (keeps)
│   └── lastDirty, lastRemoteSync, lastCommit (removed)
│   └── detectGitBranch() method (removed)
│   └── checkAndEmitGitDirty() method (removed)
├── Process scanning, port detection, tunnel reconciliation (stays)
├── handleWorkerCommandEvent → on command_end, emits pty:command-end event (git listens)
├── emitShellUpdate (stays)
```

Callers don't change signatures — `git/mutations/branches.ts` still calls `detectGitBranch()`, just imports from `git/services/status` instead of `pty/monitor`. `io-handlers.ts` imports `startGitDirtyPolling` from git domain.

Post-command git refresh: monitor emits a `pty:command-end` event, git domain listens and runs `detectGitBranch` + `checkAndEmitSingleGitDirty`. No pty→git import needed.

**Result**: Monitor becomes purely a process monitor. Git is fully self-contained. ~400 lines move out. No new cross-domain imports.

#### Option B: Git domain is stateless, monitor orchestrates

```
git/services/status.ts (new)
├── Pure git functions only (checkGitDirty, checkGitRemoteSync, checkLastCommit, etc.)
├── No state, no polling, no Socket.IO
├── Exported: checkGitDirty(cwd, sshHost), checkGitRemoteSync(cwd, sshHost), etc.
```

```
pty/monitor.ts (after)
├── TerminalMonitor class — keeps git state fields
│   └── lastDirty, lastRemoteSync, lastCommit (stays)
│   └── checkAndEmitGitDirty() — calls git/services/status, diffs, emits (stays)
│   └── detectGitBranch() — calls git/services/branch-detection, writes DB (stays)
├── scanAndEmitGitDirty, startGitDirtyPolling (stays)
├── Process scanning, port detection, everything else (stays)
```

Monitor shrinks by ~200 lines (pure git functions move) but keeps ~200 lines of orchestration, state, and polling. New dependency: `pty/monitor → git/services/status` (replaces internal calls with cross-domain import).

Git mutations still import from `pty/monitor` for the wrappers (or we re-export from git domain for ergonomics).

**Result**: Less code change, lower risk. But monitor stays a hybrid process+git orchestrator. New pty→git dependency.

### What stays in PTY monitor (both options)

- Process scanning (`scanSessions`, `scanAndEmitProcessesForTerminal`, `scanAndEmitAllProcesses`)
- Process polling infrastructure (`startGlobalProcessPolling`, `stopGlobalProcessPolling`)
- Port detection and tunnel reconciliation
- Shell `active_cmd` updates (`emitShellUpdate`) — fine where it is (one-way pty→workspace dependency)
- Session lifecycle event listeners (`pty:session-created`, `pty:session-destroyed`, etc.)

Option A additionally removes command_end git calls from the monitor (replaced by event).
Option B keeps command_end handler calling git domain directly.

---

## 2. Workspace Initialization in GitHub Polling ✅ Done

**Problem**: `github/services/checks/polling.ts` has two functions that do workspace DB writes and initialization that don't belong in the github domain.

### `trackTerminal()` (lines 268-327)

This function is called via `github:track-terminal` event. It does:

1. **Lines 272-286**: Detect git repo via `detectGitHubRepo()` → write `git_repo` to workspace DB → emit `terminal:workspace` Socket.IO
2. **Lines 288-315**: Check for `conductor.json` (local `fs.existsSync` or SSH `test -f`) → write `setup` to workspace DB → emit `terminal:workspace` Socket.IO
3. **Line 318**: Call `detectGitBranch()` from pty/monitor for SSH terminals

**What's wrong**:
- Repo detection: the result gets written to `terminals.git_repo` — a workspace DB column. GitHub domain should not write workspace state.
- Conductor detection: checking if `conductor.json` exists is a workspace/setup concern. The workspace domain already has `readConductorJson()` in `workspace/services/setup.ts:344`. GitHub is duplicating workspace setup logic.
- The whole function is workspace auto-initialization, triggered on terminal creation, not a github concern.

**Move to**: `workspace/services/auto-detect.ts` (new file). This is workspace auto-detection: given a terminal, detect its git repo, conductor config, and branch. The workspace domain already handles terminal setup — this slots in alongside it.

### When it runs

The logic doesn't disappear — it moves and keeps the same trigger points:

1. **Terminal creation** (workspace mutations) — call auto-detect directly after `dbCreateTerminal()`. Replaces the `github:track-terminal` event emission currently in `workspace/mutations/terminals.ts` (lines 114, 185, 210, 249).
2. **Session creation** — workspace listens for `pty:session-created` event and runs auto-detect. Replaces the `github:track-terminal` emission in `pty/session.ts:659`. This covers terminals that existed before the server started, or where git repo wasn't detectable at creation time but becomes detectable once a shell connects.

The `github:track-terminal` event and its listener in `github/polling.ts` are removed entirely. GitHub polling still needs to know which repos/branches to poll — it reads terminal data (read-only) and calls `detectGitHubRepo()` from git domain (after item 3 consolidation) during its polling loop.

### `refreshSSHBranch()` (lines 48-72)

Runs `git rev-parse --abbrev-ref HEAD` via SSH, then writes `git_branch` to workspace DB and emits `terminal:updated`.

**What's wrong**: This is git branch detection (git domain concern) + workspace DB write (workspace domain concern), done from the github domain.

**Move to**: This is the same operation as `detectGitBranch()` in pty/monitor (which itself is moving to git domain per item 1). After item 1 is done, this function becomes redundant — github/polling should call the git domain's branch detection instead of having its own SSH branch detection.

### Workspace DB imports to remove from polling.ts

After items 1 and 2, these imports can be removed:
```typescript
// Currently at top of polling.ts:
import { getAllTerminals, getTerminalById, updateTerminal } from '@domains/workspace/db/terminals'
```

`getAllTerminals` and `getTerminalById` are read-only and acceptable as cross-domain reads. `updateTerminal` is the problem — github should never write to workspace DB.

---

## 3. Repo Detection Duplication (3 implementations) ✅ Done

**Problem**: Three separate implementations of "detect GitHub repo from git working directory":

| Location | Function | Returns | Caching | Fallback |
|----------|----------|---------|---------|----------|
| `pty/monitor.ts:1089` | `detectRepoSlug()` | `string` ("owner/repo") | No | `ghUser/folderName` |
| `github/fetcher.ts:173` | `detectGitHubRepo()` | `{owner, repo} \| null` | Yes (repoCache) | None |
| `git/branch-detection.ts:53` | (inline read) | `terminal.git_repo?.repo` | N/A | N/A |

All three run `git remote get-url origin` and regex-parse the GitHub URL. The regex patterns differ slightly but match the same URLs.

**Consolidate to**: `git/services/resolve.ts` (already exists, currently only has `resolveGitTerminal`). Add a single `detectGitHubRepo(cwd, sshHost?, fallbackUsername?)` function that:
- Runs `git remote get-url origin` (local + SSH)
- Parses with a single regex
- If no match and `fallbackUsername` provided, returns `{ owner: fallbackUsername, repo: folderName }`
- Returns `{ owner: string; repo: string } | null`
- Includes result caching (from the github/fetcher version)

Remove `detectRepoSlug` from pty/monitor. Remove `detectGitHubRepo` + `parseGitHubRemoteUrl` from github/fetcher. Both callers import from git domain instead. Callers that want the username fallback pass `getGhUsername()` as the third arg at their call site — git domain stays unaware of github state.

---

## 4. Permission Scanner Split ✅ Done

**Problem**: `pty/services/permission-scanner.ts` has two concerns mixed together:
- **PTY concern**: Reading terminal buffer, rendering TUI output into text, pattern-matching permission prompts
- **Sessions concern**: Dedup checking against sessions DB, inserting permission messages, emitting session updates

This creates a circular dependency: sessions → pty (calls `scanAndStorePermissionPrompt`) → sessions (writes `insertPermissionMessage`, reads `getMessageByUuid`).

### Current structure

```
sessions/realtime-listener.ts:88 calls scanAndStorePermissionPrompt(sessionId, shellId)
  → pty/permission-scanner.ts:
      getSessionBuffer(shellId)              ← PTY (correct)
      scanBufferForPermissionPrompt(buffer)  ← PTY (correct: TUI rendering + pattern matching)
      getMessageByUuid(uuid)                 ← SESSIONS DB (wrong domain)
      getLatestPromptId(sessionId)           ← SESSIONS DB (wrong domain)
      insertPermissionMessage(...)           ← SESSIONS DB (wrong domain)
      io.emit('session_update', ...)         ← SESSIONS emission (wrong domain)
```

### Approach

Split `scanAndStorePermissionPrompt` into two parts:

1. **Keep in PTY** (`pty/services/permission-scanner.ts`):
   - `renderBufferLines()` — TUI emulation, pure PTY concern
   - `scanBufferForPermissionPrompt()` — already exported, returns `ParsedPermissionPrompt | null`
   - `parsePlanMode()`, `parseToolPermission()`, `parseOptions()`, `collapse()` — pattern matching helpers

2. **Move to sessions** (into `sessions/services/realtime-listener.ts` or new `sessions/services/permission-store.ts`):
   - The "store" part: dedup check, insert message, emit Socket.IO
   - `computePermissionUuid()` — session-specific dedup logic
   - The orchestration currently in `scanAndStorePermissionPrompt` lines 391-466

After the split, the call flow becomes:
```
sessions/realtime-listener.ts:
  buffer = await getSessionBuffer(shellId)          ← calls PTY for buffer
  parsed = scanBufferForPermissionPrompt(buffer)    ← calls PTY for parsing
  if (parsed) storePermissionPrompt(sessionId, parsed)  ← sessions-internal
```

This eliminates the circular sessions→pty→sessions dependency. Sessions calls two PTY functions (read buffer, parse buffer) then handles storage itself.

### Types

Permission-related types in `pty/schema.ts`:
- `ParsedPermissionPrompt`, `PermissionOption`, `PermissionPromptType`

These describe Claude session permission UI semantics, not PTY concepts. **Move to** `sessions/schema.ts` or `sessions/message-types.ts`.

### PTY websocket.ts sessions imports

`pty/websocket.ts` imports `resumePermissionSession` and `setActiveSessionDone` from sessions DB. These are triggered when the user types Enter or Ctrl+C in the terminal — PTY input events that trigger session state changes. This is a legitimate cross-domain call (PTY detects input, tells sessions to update). Leave as-is.

---

## 5. ~~Shell active_cmd Writes~~ (No Change Needed)

Originally flagged `emitShellUpdate()` in `pty/monitor.ts:256-272` as misplaced because it calls `updateShell()` (workspace DB write) from the PTY domain.

**After investigation**: This is actually fine. The dependency is one-way (pty → workspace), workspace doesn't call back into pty for this, and the monitor is the **only** writer of `active_cmd` and **only** emitter of `shell:updated`. Moving it would either reverse the dependency or create unnecessary indirection. **No change.**

---

## Execution Order

These items have some dependencies between them. Recommended order:

### Phase 1: Git types and pure functions (no decision needed)
1. Move git types from `pty/schema.ts` to `git/schema.ts` (update all imports)
2. Move pure git functions to `git/services/status.ts` (checkGitDirty, checkGitRemoteSync, checkLastCommit, parseDiffNumstat, countUntracked, countRemoteSync)
3. Consolidate repo detection into `git/services/resolve.ts` (merge detectRepoSlug + detectGitHubRepo, add `fallbackUsername` param)

### Phase 2: Git status infrastructure (depends on Option A vs B decision)

**If Option A** (full extraction):
4. Move per-terminal git state, diffing, polling, and Socket.IO emission to `git/services/status.ts`
5. Unify branch detection with existing `git/services/branch-detection.ts:detectBranch()`
6. Add `pty:command-end` event — monitor emits on command_end, git domain listens
7. Remove all git fields and methods from `TerminalMonitor` class
8. Update `git/mutations/branches.ts` and `git/mutations/commit.ts` to import from `git/services/status`
9. Update `io-handlers.ts` to import `startGitDirtyPolling` from git domain

**If Option B** (stateless git, monitor orchestrates):
4. Update monitor's git methods to call `git/services/status.ts` for raw data
5. Unify branch detection with existing `git/services/branch-detection.ts:detectBranch()`
6. Update `git/mutations/branches.ts` and `git/mutations/commit.ts` to import from git domain (re-export wrappers or move wrappers)
7. Update `io-handlers.ts` to import `startGitDirtyPolling` from git domain (or re-export from monitor)

### Phase 3: Workspace auto-detection
8. Move `trackTerminal()` logic to workspace domain (auto-detect repo, conductor)
9. Remove `refreshSSHBranch()` from github/polling (use git domain's branch detection)
10. Remove `updateTerminal` import from github/polling.ts

### Phase 4: Permission scanner
11. Split permission-scanner.ts — keep PTY parsing, move storage to sessions
12. Move permission types from pty/schema to sessions
13. Update realtime-listener.ts to orchestrate the split functions

---

## What This Does NOT Cover

- **logCommand imports**: Used from 6 domains as an infrastructure utility. Fine as-is.
- **emitNotification/sendPushNotification imports**: Cross-cutting concern similar to logging. Fine as-is.
- **Settings reads**: Multiple domains reading `getSettings()` is fine — settings is a shared config store.
- **Workspace reads from other domains**: `getTerminalById()`, `getShellById()`, `getAllTerminals()` are read-only lookups. Acceptable cross-domain reads.

---

## Phase 5 (Future): Event System Restructuring

After decoupling is complete, investigate restructuring the `serverEvents` event system. The goal is to replace ad-hoc imperative command events and remaining fire-and-forget cross-domain calls with structured lifecycle events.

### What to investigate

**1. Audit all remaining `serverEvents.emit()` and `serverEvents.on()` calls after decoupling.**

After phases 1-4, some events will have been removed (e.g. `github:track-terminal`) and some added (e.g. `pty:command-end` if Option A). Map what's left — which events still exist, who emits them, who listens, and whether each event is a lifecycle event (describes what happened) or an imperative command (tells another domain to do something).

**2. Identify remaining fire-and-forget cross-domain calls that aren't events yet.**

After decoupling, git mutations will still call `detectGitBranch()` and `checkAndEmitSingleGitDirty()` as fire-and-forget side effects (11 call sites). If Option A was chosen, these already moved to git domain (internal calls, no issue). If Option B, the monitor still exports them and git mutations import from pty — these are prime candidates for a `git:ref-changed` event.

Other fire-and-forget patterns to check:
- `workspace/mutations/terminals.ts` calling `pty/session.destroySessionsForTerminal()` — could this be `terminal:deleting` event instead?
- `github/mutations.ts` calling `refreshPRChecks(true)` without await — already internal to github domain, probably fine.
- All the Socket.IO emissions scattered across domains (`terminal:updated`, `terminal:workspace`, `shell:updated`, `git:dirty-status`, etc.) — these are client-facing, not server events, but worth cataloging.

**3. Evaluate whether to replace the untyped `EventEmitter` with a typed event map.**

Currently `serverEvents` is a plain `EventEmitter` — event names are strings, payloads are typed inline at each listener with no compile-time checking that emitters and listeners agree. Investigate adding a `ServerEventMap` interface:

```typescript
interface ServerEventMap {
  'pty:session-created': { terminalId: number }
  'pty:session-destroyed': { shellId: number; terminalId: number; sshHost: string | null }
  // etc.
}
```

Check if this can be done with Node's `EventEmitter` generics or if a thin typed wrapper is needed. Assess whether it's worth the effort given the number of events.

**4. Decide on event naming conventions.**

Current events mix styles: `pty:session-created` (lifecycle, past tense — good), `github:refresh-pr-checks` (imperative command — should become lifecycle). Propose a convention and check whether existing events conform or need renaming.

### How to investigate

- Start by running `grep -n 'serverEvents.emit\|serverEvents.on'` across the full `server/` directory after decoupling is done — the landscape will have changed.
- For each remaining cross-domain import, ask: "Is the caller using the return value, or is this fire-and-forget?" Fire-and-forget calls are event candidates.
- Don't over-event things. Direct calls are fine when the caller needs the result, when the dependency is one-way, or when it's infrastructure (logging, notifications). Events are for decoupling domains that shouldn't know about each other.
