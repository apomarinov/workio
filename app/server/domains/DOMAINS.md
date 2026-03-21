# Domain Refactoring Plan

Target structure for migrating the server codebase into isolated domains with tRPC routers. Each domain is currently scattered across `db.ts`, `routes/`, and various service files — this plan shows where everything lands after migration.

## Dependencies


| Domain            | Imports from                       | Why                                                                                                       |
| ----------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **workspace**     | notifications                      | `emitWorkspace` calls `emitNotification`                                                                  |
| **pty**           | workspace, sessions, notifications | Terminal/shell info for sessions; permission scanner writes to sessions DB; sends push notifications      |
| **git**           | workspace, logs                    | Needs terminal cwd/ssh_host to run git; logs git commands                                                 |
| **sessions**      | workspace, settings                | Terminal/project lookups for backfill/move; settings for favorites                                        |
| **github**        | workspace, logs, settings          | Terminal tracking for branch detection; logs GitHub API calls; reads `GHQueryLimits` from settings schema |
| **logs**          | workspace                          | `logCommand` reads terminal name/ssh_host via `getTerminalById`                                           |
| **settings**      | —                                  | Standalone                                                                                                |
| **notifications** | settings                           | Reads/updates settings for push subscription management                                                   |


```
workspace     ← pty
workspace     ← git
workspace     ← sessions
workspace     ← github
workspace     ← logs
sessions      ← pty
settings      ← sessions
settings      ← github
settings      ← notifications
notifications ← workspace
notifications ← pty
logs          ← git
logs          ← github
```

No circular dependencies. `workspace`, `settings`, and `logs` are leaf nodes that everything else builds on.

## Structure

```
server/domains/
│
├── workspace/
│   ├── schema.ts
│   ├── db/
│   │   ├── terminals.ts         (12 functions)
│   │   │   ├── getAllTerminals
│   │   │   ├── getTerminalById
│   │   │   ├── createTerminal
│   │   │   ├── updateTerminal
│   │   │   ├── deleteTerminal
│   │   │   ├── terminalCwdExists
│   │   │   ├── terminalNameExists
│   │   │   ├── getUniqueTerminalName
│   │   │   ├── attachShellsToTerminals
│   │   │   ├── getProjectByPath
│   │   │   ├── getProjectById
│   │   │   └── upsertProject
│   │   └── shells.ts            (7 functions)
│   │       ├── createShell
│   │       ├── getShellById
│   │       ├── getShellsForTerminal
│   │       ├── getMainShellForTerminal
│   │       ├── deleteShell
│   │       ├── updateShellName
│   │       └── updateShell
│   ├── queries/
│   │   ├── terminals.ts         (3 tRPC queries)
│   │   │   ├── list                      GET /api/terminals
│   │   │   ├── getById                   GET /api/terminals/:id
│   │   │   └── sshHosts                  GET /api/ssh/hosts
│   │   └── system.ts            (7 tRPC queries/mutations)
│   │       ├── browseFolder              GET /api/browse-folder
│   │       ├── listDirectories           POST /api/list-directories
│   │       ├── sshAudit                  GET /api/ssh/audit
│   │       ├── sshFixMaxSessions         POST /api/ssh/fix-max-sessions
│   │       ├── openFullDiskAccess        POST /api/open-full-disk-access
│   │       ├── openInIde                 POST /api/open-in-ide
│   │       └── openInExplorer            POST /api/open-in-explorer
│   ├── mutations.ts             (13 tRPC mutations)
│   │   ├── create                    POST /api/terminals
│   │   ├── update                    PATCH /api/terminals/:id
│   │   ├── delete                    DELETE /api/terminals/:id
│   │   ├── cancelWorkspace           POST /api/terminals/:id/cancel-workspace
│   │   ├── rerunSetup                POST /api/terminals/:id/rerun-setup
│   │   ├── clearSetupError           POST /api/terminals/:id/clear-setup-error
│   │   ├── createShell               POST /api/terminals/:id/shells
│   │   ├── deleteShell               DELETE /api/shells/:id
│   │   ├── renameShell               PATCH /api/shells/:id
│   │   ├── writeShell                POST /api/shells/:id/write
│   │   ├── interruptShell            POST /api/shells/:id/interrupt
│   │   ├── killShell                 POST /api/shells/:id/kill
│   │   └── createDirectory           POST /api/create-directory
│   ├── router.ts
│   └── services/
│       ├── setup.ts             (3 functions)
│       │   ├── cancelWorkspace
│       │   ├── rerunSetup
│       │   └── clearSetupError
│       └── system.ts            (2 functions)
│           ├── getParentAppName
│           └── getParentAppNameCached
│
├── pty/
│   ├── ipc-types.ts             (IPC message types between master and workers)
│   ├── session.ts               (PtySession class — per-shell worker lifecycle + state)
│   │   │                        Replaces session-proxy.ts + per-shell Maps from manager.ts.
│   │   │                        Each instance owns: worker process, callbacks, timeout,
│   │   │                        pending command, bell subscription — no more scattered Maps.
│   │   │                        Module-level sessions Map<shellId, PtySession> + lookup helpers.
│   │   ├── class PtySession
│   │   │   ├── write(data)
│   │   │   ├── resize(cols, rows)
│   │   │   ├── interrupt()
│   │   │   ├── killChildren()
│   │   │   ├── getBuffer()
│   │   │   ├── destroy()
│   │   │   ├── attach(onData, onExit, onCommandEvent)
│   │   │   ├── startTimeout() / clearTimeout()
│   │   │   ├── setPendingCommand(cmd) / flushPendingCommand()
│   │   │   ├── subscribeBell(sub) / unsubscribeBell()
│   │   │   ├── waitForMarker() / cancelWaitForMarker()
│   │   │   ├── waitForReady(timeoutMs)
│   │   │   └── updateName(name)
│   │   ├── createSession(shellId, cols, rows, onData, onExit, onCommandEvent)
│   │   ├── getSession(shellId)
│   │   ├── getSessionByTerminalId(terminalId)
│   │   ├── hasActiveSession(shellId)
│   │   ├── hasActiveSessionForTerminal(terminalId)
│   │   ├── destroyAllSessions()
│   │   ├── getBellSubscribedShellIds()
│   │   ├── writeShellIntegrationScripts()
│   │   ├── writeTerminalNameFile(terminalId, name)
│   │   ├── writeShellNameFile(shellId, name)
│   │   └── renameZellijSession(oldName, newName, sshHost?)
│   ├── monitor.ts               (TerminalMonitor class — per-terminal polling + caching)
│   │   │                        Replaces per-terminal Maps from manager.ts (lastDirtyStatus,
│   │   │                        lastCommitStatus, lastRemoteSyncStatus, processFirstSeen,
│   │   │                        processPollTimeoutIds, sshHostInfoCache). Each instance owns
│   │   │                        its cached state; dispose() clears everything.
│   │   │                        Module-level monitors Map<terminalId, TerminalMonitor> +
│   │   │                        global polling intervals.
│   │   ├── class TerminalMonitor
│   │   │   ├── scanProcesses()
│   │   │   ├── checkGitDirty()
│   │   │   ├── checkGitRemoteSync()
│   │   │   ├── checkLastCommit()
│   │   │   ├── detectGitBranch()
│   │   │   ├── detectRepoSlug()
│   │   │   └── dispose()
│   │   ├── scanAndEmitProcessesForTerminal(terminalId)
│   │   ├── checkAndEmitSingleGitDirty(terminalId)
│   │   ├── startGitDirtyPolling()
│   │   ├── startGlobalProcessPolling() / stopGlobalProcessPolling()
│   │   ├── scanAndEmitAllProcesses()
│   │   └── handleWorkerCommandEvent(terminalId, shellId, event, handle)
│   ├── websocket.ts             (ShellClients class + WebSocket server)
│   │   │                        Replaces shells/wsInfo/resizeTimers Maps from ws/terminal.ts.
│   │   │                        Each ShellClients instance owns its connected clients,
│   │   │                        primary/secondary promotion, and resize debouncing.
│   │   ├── class ShellClients
│   │   │   ├── addClient(ws, info) / removeClient(ws)
│   │   │   ├── claimPrimary(ws) / releasePrimary()
│   │   │   ├── broadcast(data) / broadcastExit(code)
│   │   │   └── get isEmpty
│   │   ├── handleUpgrade(request, socket, head)
│   │   └── emitAllShellClients(socket)
│   ├── services/
│   │   ├── worker.ts            (PTY child process entry point — isolated process, no classes)
│   │   ├── osc-parser.ts        (2 functions — OSC 133 shell integration parser)
│   │   │   ├── createOscParser
│   │   │   └── type CommandEvent
│   │   ├── permission-scanner.ts (2 functions — Claude permission prompt scanner)
│   │   │   ├── scanBufferForPermissionPrompt
│   │   │   └── scanAndStorePermissionPrompt
│   │   └── process-tree.ts      (16 pure/IO-only functions — process introspection)
│   │       ├── getChildPids
│   │       ├── getChildProcesses
│   │       ├── getProcessComm
│   │       ├── getZellijSessionProcesses
│   │       ├── getDescendantPids
│   │       ├── getSystemResourceUsage
│   │       ├── getSystemMemoryUsage
│   │       ├── getSystemListeningPorts
│   │       ├── getListeningPortsForTerminal
│   │       ├── getActiveZellijSessionNames
│   │       ├── getRemoteHostInfo
│   │       ├── getRemoteProcessList
│   │       ├── getRemoteDescendantPids
│   │       ├── findRemoteZellijServerPid
│   │       ├── getRemoteZellijSessionProcesses
│   │       ├── getRemoteListeningPorts
│   │       └── getRemoteListeningPortsForTerminal
│   └── shell.ts                 (3 functions — shell write/interrupt/kill)
│       ├── writeShell
│       ├── interruptShell
│       └── killShell
│
├── git/
│   ├── schema.ts
│   ├── queries.ts               (6 tRPC queries)
│   │   ├── branches                  GET /api/terminals/:id/branches
│   │   ├── branchCommits             GET /api/terminals/:id/branch-commits
│   │   ├── commits                   GET /api/terminals/:id/commits
│   │   ├── headMessage               GET /api/terminals/:id/head-message
│   │   ├── changedFiles              GET /api/terminals/:id/changed-files
│   │   └── fileDiff                  GET /api/terminals/:id/file-diff
│   ├── mutations.ts             (13 tRPC mutations)
│   │   ├── fetchAll                  POST /api/terminals/:id/fetch-all
│   │   ├── checkout                  POST /api/terminals/:id/checkout
│   │   ├── pull                      POST /api/terminals/:id/pull
│   │   ├── push                      POST /api/terminals/:id/push
│   │   ├── deleteBranch              DELETE /api/terminals/:id/branch
│   │   ├── renameBranch              POST /api/terminals/:id/rename-branch
│   │   ├── createBranch              POST /api/terminals/:id/create-branch
│   │   ├── commit                    POST /api/terminals/:id/commit
│   │   ├── discard                   POST /api/terminals/:id/discard
│   │   ├── rebase                    POST /api/terminals/:id/rebase
│   │   ├── undoCommit                POST /api/terminals/:id/undo-commit
│   │   ├── dropCommit                POST /api/terminals/:id/drop-commit
│   │   └── branchConflicts           GET /api/terminals/:id/branch-conflicts
│   ├── router.ts
│   └── services/
│       └── git.ts               (3 functions)
│           ├── fetchOriginIfNeeded
│           ├── parseUntrackedWc
│           └── parseChangedFiles
│
├── sessions/
│   ├── schema.ts
│   ├── db.ts                    (18 functions)
│   │   ├── getAllSessions
│   │   ├── getSessionById
│   │   ├── getSessionMessages
│   │   ├── getMessagesByIds
│   │   ├── updateSession
│   │   ├── updateSessionData
│   │   ├── updateSessionMove
│   │   ├── setActiveSessionDone
│   │   ├── resumePermissionSession
│   │   ├── deleteSession
│   │   ├── deleteSessions
│   │   ├── deleteSessionCascade
│   │   ├── getOldSessionIds
│   │   ├── getSessionTranscriptPaths
│   │   ├── insertBackfilledSession
│   │   ├── getActivePermissions
│   │   ├── getLatestPromptId
│   │   ├── getMessageByUuid
│   │   └── insertPermissionMessage
│   ├── queries.ts               (5 tRPC queries)
│   │   ├── list                      GET /api/sessions
│   │   ├── getById                   GET /api/sessions/:id
│   │   ├── messages                  GET /api/sessions/:id/messages
│   │   ├── search                    GET /api/sessions/search
│   │   └── activePermissions         GET /api/permissions/active
│   ├── mutations.ts             (7 tRPC mutations)
│   │   ├── update                    PATCH /api/sessions/:id
│   │   ├── delete                    DELETE /api/sessions/:id
│   │   ├── bulkDelete                DELETE /api/sessions
│   │   ├── toggleFavorite            POST /api/sessions/:id/favorite
│   │   ├── cleanup                   POST /api/sessions/cleanup
│   │   ├── moveTargets               GET /api/sessions/:id/move-targets
│   │   └── move                      POST /api/sessions/:id/move
│   ├── router.ts
│   └── services/
│       ├── search.ts            (2 functions)
│       │   ├── searchSessionMessages
│       │   └── buildResults
│       ├── backfill.ts          (5 functions)
│       │   ├── backfillCheck
│       │   ├── backfillRun
│       │   ├── isRealSession
│       │   ├── readLastTimestamp
│       │   └── readSessionBranches
│       ├── move.ts              (8 functions)
│       │   ├── moveSession
│       │   ├── appendMoveMetaMessage
│       │   ├── updateSessionsIndexLocal
│       │   ├── updateSessionsIndexRemote
│       │   ├── readLocalFile
│       │   ├── readRemoteFile
│       │   ├── readRemoteJson
│       │   └── writeRemoteJson
│       └── hook.ts              (2 functions)
│           ├── forwardToDaemon
│           └── handleClaudeHook
│
├── github/
│   ├── schema.ts
│   ├── queries.ts               (4 tRPC queries)
│   │   ├── repos                     GET /api/github/repos
│   │   ├── conductor                 GET /api/github/conductor
│   │   ├── closedPRs                 GET /api/github/closed-prs
│   │   └── involvedPRs               GET /api/github/involved-prs
│   ├── mutations.ts             (14 tRPC mutations)
│   │   ├── requestReview
│   │   ├── merge
│   │   ├── close
│   │   ├── rename
│   │   ├── edit
│   │   ├── create
│   │   ├── comment
│   │   ├── replyToComment
│   │   ├── editComment
│   │   ├── addReaction
│   │   ├── removeReaction
│   │   ├── rerunCheck
│   │   ├── rerunAllChecks
│   │   └── webhookReceiver
│   ├── router.ts
│   └── services/
│       ├── checks.ts            (14 functions)
│       │   ├── parseGitHubRemoteUrl
│       │   ├── getGhUsername
│       │   ├── refreshPRChecks
│       │   ├── trackTerminal
│       │   ├── untrackTerminal
│       │   ├── startChecksPolling
│       │   ├── stopChecksPolling
│       │   ├── fetchPRComments
│       │   ├── emitCachedPRChecks
│       │   ├── detectAllTerminalBranches
│       │   ├── initGitHubChecks
│       │   ├── queueWebhookRefresh
│       │   ├── handleInvolvedPRWebhook
│       │   └── applyWebhookAndRefresh
│       └── webhooks.ts          (10 functions)
│           ├── getOrCreateWebhookSecret
│           ├── initNgrok
│           ├── createRepoWebhook
│           ├── deleteRepoWebhook
│           ├── recreateRepoWebhook
│           ├── testWebhook
│           ├── startWebhookValidationPolling
│           ├── stopWebhookValidationPolling
│           ├── stopNgrok
│           └── verifyWebhookSignature
│
├── logs/
│   ├── schema.ts
│   ├── db.ts                    (1 function)
│   │   └── logCommand
│   ├── queries.ts               (2 tRPC queries)
│   │   ├── list                      GET /api/command-logs
│   │   └── terminals                 GET /api/command-logs/terminals
│   └── router.ts
│
├── settings/                    # already done
└── notifications/               # already done
```

## Shared Server Infrastructure

These files stay in place — they're cross-cutting concerns used by all domains, not part of the domain migration.

- `server/io.ts` — Socket.IO singleton, `broadcastRefetch`, `getIO`
- `server/listen.ts` — PostgreSQL LISTEN/NOTIFY → Socket.IO bridge
- `server/index.ts` — Server bootstrap, Socket.IO event handlers
- `server/lib/` — Shared utilities (exec, git, strings, zod)
- `server/ssh/` — SSH pool, exec, config, tunnel, claude-forwarding
- `server/logger.ts` — Pino logger
- `server/env.ts` — Environment config
- `server/services/status.ts` — Service health tracking

## Totals


| Domain        | db  | queries | mutations | service fns | total |
| ------------- | --- | ------- | --------- | ----------- | ----- |
| **workspace** | 19  | 10      | 13        | 5           | 47    |
| **pty**       | 0   | 0       | 0         | 58          | 58    |
| **git**       | 0   | 6       | 13        | 3           | 22    |
| **sessions**  | 18  | 5       | 7         | 17          | 47    |
| **github**    | 0   | 4       | 14        | 24          | 42    |
| **logs**      | 1   | 2       | 0         | 0           | 3     |


## Migration Order


| #   | Domain        | Status | Notes                                                                                                                                                           |
| --- | ------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **logs**      | [x]    | Smallest (3 functions), no deps on other unmigrated domains, good warmup to establish the pattern                                                               |
| 2   | **workspace** | [x]    | Leaf node, no domain deps, but large. Must be done before pty/git/sessions/github since they all import from it                                                 |
| 3   | **pty**       | [ ]    | Depends on workspace + sessions, but sessions only for permission-scanner (can stub/defer that one call). Doing it 3rd unblocks the PTY-related shell mutations |
| 4   | **git**       | [ ]    | Depends on workspace + logs, both done by now                                                                                                                   |
| 5   | **sessions**  | [ ]    | Depends on workspace + settings (already done). Large but self-contained                                                                                        |
| 6   | **github**    | [ ]    | Depends on workspace + logs, both done. Last because it's mostly already isolated in `server/github/` and the routes are thin wrappers                          |


Steps 4 and 5 can be done in either order or in parallel since they don't depend on each other.

## Sub-groups

### workspace (47 functions → 4 sub-groups)


| Done | Sub-group     | Count | What                                                                                                                              | Client usage                                                            |
| ---- | ------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [x]  | **terminals** | 15    | CRUD, project upsert, name uniqueness                                                                                             | Sidebar list, CreateTerminalModal, EditTerminalModal                    |
| [x]  | **shells**    | 10    | create, delete, rename, get, write, interrupt, kill                                                                               | Shell tabs in terminal, context menu                                    |
| [x]  | **setup**     | 5     | cancel, rerun, clear error, setupWorkspace, emitWorkspace                                                                         | EditTerminalModal lifecycle buttons, CreateTerminalModal                |
| [x]  | **system**    | 10+   | browse folder, list dirs, create dir, open IDE/explorer, SSH hosts/audit/fix-max-sessions, full disk access, parent app detection | DirectoryBrowser, Terminal context menu, CreateTerminalModal SSH picker |


### pty (58 functions → 6 sub-groups)

Current state: ~15 module-level Maps spread across `manager.ts`, `session-proxy.ts`, and `ws/terminal.ts`, all keyed by `shellId` or `terminalId`. Functions take an ID, do `map.get(id)`, and mutate scattered state. Cleanup (e.g. `destroySession`) must remember to touch every Map — easy to leave orphaned entries.

Refactored state: 3 Maps (`sessions`, `monitors`, `shellClients`), each holding a class instance that owns all its related state. `destroy()`/`dispose()` cleans up in one place.

Migration order within pty (each step is independently shippable):

| #   | Done | Sub-group             | Count | What                                                                                                | Notes                                                                                          |
| --- | ---- | --------------------- | ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | [x]  | **shell-integration** | 4     | `osc-parser.ts` (factory + CommandEvent type), `ipc-types.ts`, `permission-scanner.ts`              | Leaf deps — `osc-parser` has zero imports, `ipc-types` only imports CommandEvent type from it   |
| 2   | [x]  | **process-tree**      | 16    | child PIDs, process comm, zellij sessions, memory, resource usage, listening ports (local + remote) | Pure/IO-only functions, external deps only (exec, ssh/pool, logger) — move as-is               |
| 3   | [x]  | **worker**            | 1     | PTY child process entry point (isolated process, no classes)                                        | Imports osc-parser + ipc-types + process-tree (steps 1-2) + ssh-pty-adapter — move as-is       |
| 4   | [x]  | **session**           | ~26   | `PtySession` class: worker IPC, write/resize/interrupt, timeout, pending commands, bell, naming     | Big refactor — merges `session-proxy.ts` + per-shell Maps from `manager.ts` into class          |
| 5   | [ ]  | **monitor**           | ~17   | `TerminalMonitor` class: git dirty/commit/remote-sync caching, process/port scanning, polling       | Extracts per-terminal Maps from `manager.ts`; depends on session (step 4) + process-tree        |
| 6   | [ ]  | **websocket**         | ~14   | `ShellClients` class: per-shell client tracking, primary/secondary, resize debounce, broadcasting   | Refactors `ws/terminal.ts`; depends on session (step 4)                                         |
| 7   | [ ]  | **shell**             | 3     | writeShell, interruptShell, killShell                                                               | Thin wrappers over session — move last since they depend on session (step 4)                    |

Steps 1-3 are pure moves (no refactoring, no classes). Step 4 is the core refactor. Steps 5-7 depend on step 4 but are independent of each other.

Note: `permission-scanner.ts` currently has a circular import on `manager.getSessionBuffer` — this breaks naturally when step 4 replaces manager with `PtySession.getBuffer()`.

### sessions (46 functions → 7 sub-groups)


| Done | Sub-group       | Count | What                                                                                      | Client usage                                                   |
| ---- | --------------- | ----- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [ ]  | **crud**        | 12    | list, getById, update, delete, bulkDelete, cleanup, favorites                             | SessionContext sidebar, context menus, CleanupModal            |
| [ ]  | **messages**    | 4     | getMessages, getByIds, getByUuid                                                          | SessionChat, paginated message viewer                          |
| [ ]  | **search**      | 2     | searchSessionMessages, buildResults                                                       | SessionSearchPanel — full-text search with repo/branch filters |
| [ ]  | **backfill**    | 5     | backfillCheck, backfillRun, isRealSession, readLastTimestamp, readSessionBranches         | BackfillModal — import sessions from JSONL files               |
| [ ]  | **move**        | 9     | moveSession, moveTargets, appendMeta, updateIndex local/remote, snapshots                 | Command palette "Move To Project" action                       |
| [ ]  | **permissions** | 4     | getActivePermissions, getLatestPromptId, insertPermissionMessage, resumePermissionSession | useActivePermissions hook — permission indicators on sessions  |
| [ ]  | **hook**        | 2     | forwardToDaemon, handleClaudeHook                                                         | No direct client usage — receives from SSH reverse tunnel      |


### github (42 functions → 5 sub-groups)


| Done | Sub-group     | Count | What                                                                                   | Client usage                                                          |
| ---- | ------------- | ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [ ]  | **pr-data**   | 8     | fetchClosedPRs, fetchInvolvedPRs, refreshPRChecks, polling, branch detection, caching  | GitHubContext — sidebar PR list, socket `github:pr-checks`            |
| [ ]  | **pr-ops**    | 8     | merge, close, create, edit, rename, requestReview                                      | MergeDialog, EditPRDialog, ReReviewDialog, command palette            |
| [ ]  | **comments**  | 6     | addComment, replyToReview, editIssueComment, editReviewComment, editReview             | PRStatusContent — discussion timeline, ReplyDialog, EditCommentDialog |
| [ ]  | **reactions** | 2     | addReaction, removeReaction                                                            | PRStatusContent — emoji reaction badges                               |
| [ ]  | **webhooks**  | 10    | ngrok init/stop, webhook CRUD, signature verify, validation polling, secret management | CreateTerminalModal (webhook setup), no direct UI for most            |


Plus `repos` and `conductor` queries used only by CreateTerminalModal for repo selection.

### git (22 functions → 3 sub-groups)


| Done | Sub-group    | Count | What                                                                                             | Client usage                                  |
| ---- | ------------ | ----- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| [ ]  | **branches** | 10    | list, checkout, create, delete, rename, fetch-all, pull, push, rebase                            | Branch palette, command palette actions       |
| [ ]  | **diff**     | 6     | changedFiles, fileDiff, headMessage, commits, branchCommits, branchConflicts                     | CommitDialog, FileDiffViewer, BranchDiffPanel |
| [ ]  | **commit**   | 6     | commit, discard, undoCommit, dropCommit, fetchOriginIfNeeded, parseChangedFiles/parseUntrackedWc | CommitDialog stage/commit/discard             |


### logs (3 functions)

Small enough to not need sub-groups.