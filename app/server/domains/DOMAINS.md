# Domain Refactoring Plan

## Dependencies

| Domain | Imports from | Why |
|---|---|---|
| **workspace** | — | Core entity, no domain deps |
| **pty** | workspace, sessions | Needs terminal/shell info to create sessions; permission scanner writes to sessions DB |
| **git** | workspace, logs | Needs terminal cwd/ssh_host to run git; logs git commands |
| **sessions** | workspace, settings | Terminal/project lookups for backfill/move; settings for favorites |
| **github** | workspace, logs | Terminal tracking for branch detection; logs GitHub API calls |
| **logs** | workspace | `logCommand` reads terminal name/ssh_host via `getTerminalById` |
| **settings** | — | Standalone |
| **notifications** | — | Standalone |

```
workspace ← pty
workspace ← git
workspace ← sessions
workspace ← github
workspace ← logs
sessions  ← pty
settings  ← sessions
logs      ← git
logs      ← github
```

No circular dependencies. `workspace` and `settings` are leaf nodes that everything else builds on.

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
│   │       ├── sshPing                   POST /api/ssh/ping
│   │       ├── openFullDiskAccess        POST /api/open-full-disk-access
│   │       ├── openInIde                 POST /api/open-in-ide
│   │       └── openInExplorer            POST /api/open-in-explorer
│   ├── mutations.ts             (10 tRPC mutations)
│   │   ├── create                    POST /api/terminals
│   │   ├── update                    PATCH /api/terminals/:id
│   │   ├── delete                    DELETE /api/terminals/:id
│   │   ├── cancelWorkspace           POST /api/terminals/:id/cancel-workspace
│   │   ├── rerunSetup                POST /api/terminals/:id/rerun-setup
│   │   ├── clearSetupError           POST /api/terminals/:id/clear-setup-error
│   │   ├── createShell               POST /api/terminals/:id/shells
│   │   ├── deleteShell               DELETE /api/shells/:id
│   │   ├── renameShell               PATCH /api/shells/:id
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
│   ├── services/
│   │   ├── session-proxy.ts     (15 functions — master-side worker pool)
│   │   │   ├── createSession
│   │   │   ├── attachSession
│   │   │   ├── destroySession
│   │   │   ├── getSession
│   │   │   ├── writeToSession
│   │   │   ├── resizeSession
│   │   │   ├── interruptSession
│   │   │   ├── killShellChildren
│   │   │   ├── getSessionBuffer
│   │   │   ├── waitForMarker
│   │   │   ├── waitForSession
│   │   │   ├── startSessionTimeout
│   │   │   ├── clearSessionTimeout
│   │   │   ├── updateSessionName
│   │   │   └── getAllWorkers
│   │   ├── manager.ts          (8 functions — high-level PTY API)
│   │   │   ├── setPendingCommand
│   │   │   ├── getBellSubscribedShellIds
│   │   │   ├── subscribeBell
│   │   │   ├── unsubscribeBell
│   │   │   ├── writeShellIntegrationScripts
│   │   │   ├── detectGitBranch
│   │   │   ├── startGitDirtyPolling
│   │   │   └── setCommandEventHandler
│   │   ├── worker.ts           (PTY child process entry point)
│   │   ├── osc-parser.ts       (2 functions — OSC 133 shell integration parser)
│   │   │   ├── createOscParser
│   │   │   └── type CommandEvent
│   │   ├── permission-scanner.ts (2 functions — Claude permission prompt scanner)
│   │   │   ├── scanBufferForPermissionPrompt
│   │   │   └── scanAndStorePermissionPrompt
│   │   ├── process-tree.ts      (10 functions — process introspection)
│   │   │   ├── getChildPids
│   │   │   ├── getProcessComm
│   │   │   ├── getZellijSessionProcesses
│   │   │   ├── getSystemMemoryUsage
│   │   │   ├── getRemoteHostInfo
│   │   │   ├── getRemoteZellijSessionProcesses
│   │   │   ├── getListeningPorts
│   │   │   ├── getDescendantPids
│   │   │   ├── getResourceUsage
│   │   │   └── findPidByPort
│   │   └── websocket.ts        (3 functions — WebSocket PTY streaming)
│   │       ├── handleUpgrade
│   │       ├── emitAllShellClients
│   │       └── handleConnection
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
│       ├── move.ts              (7 functions)
│       │   ├── moveSession
│       │   ├── appendMoveMetaMessage
│       │   ├── updateSessionsIndexLocal
│       │   ├── updateSessionsIndexRemote
│       │   ├── readLocalFile
│       │   ├── readRemoteFile
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
│       ├── checks.ts            (16 functions)
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
│       │   ├── applyWebhookAndRefresh
│       │   ├── readRemoteJson
│       │   └── writeRemoteJson
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

## Totals

| Domain | db | queries | mutations | service fns | total |
|---|---|---|---|---|---|
| **workspace** | 19 | 10 | 10 | 5 | 44 |
| **pty** | 0 | 0 | 0 | 43 | 43 |
| **git** | 0 | 6 | 13 | 3 | 22 |
| **sessions** | 18 | 5 | 7 | 16 | 46 |
| **github** | 0 | 4 | 14 | 26 | 44 |
| **logs** | 1 | 2 | 0 | 0 | 3 |

## Migration Order

1. **logs** — smallest (3 functions), no deps on other unmigrated domains, good warmup to establish the pattern
2. **workspace** — leaf node, no domain deps, but large. Must be done before pty/git/sessions/github since they all import from it
3. **pty** — depends on workspace + sessions, but sessions only for permission-scanner (can stub/defer that one call). Doing it 3rd unblocks the PTY-related shell mutations
4. **git** — depends on workspace + logs, both done by now
5. **sessions** — depends on workspace + settings (already done). Large but self-contained
6. **github** — depends on workspace + logs, both done. Last because it's mostly already isolated in `server/github/` and the routes are thin wrappers

Steps 4 and 5 can be done in either order or in parallel since they don't depend on each other.

## Sub-groups

### workspace (44 functions → 4 sub-groups)

| Sub-group | Count | What | Client usage |
|---|---|---|---|
| **terminals** | 15 | CRUD, project upsert, name uniqueness | Sidebar list, CreateTerminalModal, EditTerminalModal |
| **shells** | 7 | create, delete, rename, get | Shell tabs in terminal, context menu |
| **setup** | 5 | cancel, rerun, clear error, setupWorkspace, emitWorkspace | EditTerminalModal lifecycle buttons, CreateTerminalModal |
| **system** | 10+ | browse folder, list dirs, create dir, open IDE/explorer, SSH hosts/audit/ping, full disk access, parent app detection | DirectoryBrowser, Terminal context menu, CreateTerminalModal SSH picker |

### pty (43 functions → 5 sub-groups)

| Sub-group | Count | What | Notes |
|---|---|---|---|
| **session-proxy** | 15 | create, attach, destroy, write, resize, buffer, timeout | Worker pool — master-side lifecycle of PTY processes |
| **manager** | 8 | pending command, bell subscriptions, shell integration scripts, git branch/dirty polling | High-level API that other domains call |
| **process-tree** | 10 | child PIDs, process comm, zellij sessions, memory, remote host info, ports, resource usage | Process introspection for terminal status display |
| **shell-integration** | 4 | OSC parser, command events, permission scanner | Parsing terminal output for commands and Claude prompts |
| **websocket** | 3 | handleUpgrade, handleConnection, emitAllShellClients | WebSocket PTY streaming to browser |

Plus `worker.ts` (standalone child process) and `ipc-types.ts` (shared types).

### sessions (46 functions → 7 sub-groups)

| Sub-group | Count | What | Client usage |
|---|---|---|---|
| **crud** | 12 | list, getById, update, delete, bulkDelete, cleanup, favorites | SessionContext sidebar, context menus, CleanupModal |
| **messages** | 4 | getMessages, getByIds, getByUuid | SessionChat, paginated message viewer |
| **search** | 2 | searchSessionMessages, buildResults | SessionSearchPanel — full-text search with repo/branch filters |
| **backfill** | 5 | backfillCheck, backfillRun, isRealSession, readLastTimestamp, readSessionBranches | BackfillModal — import sessions from JSONL files |
| **move** | 9 | moveSession, moveTargets, appendMeta, updateIndex local/remote, snapshots | Command palette "Move To Project" action |
| **permissions** | 4 | getActivePermissions, getLatestPromptId, insertPermissionMessage, resumePermissionSession | useActivePermissions hook — permission indicators on sessions |
| **hook** | 2 | forwardToDaemon, handleClaudeHook | No direct client usage — receives from SSH reverse tunnel |

### github (44 functions → 5 sub-groups)

| Sub-group | Count | What | Client usage |
|---|---|---|---|
| **pr-data** | 10 | fetchClosedPRs, fetchInvolvedPRs, refreshPRChecks, polling, branch detection, caching | GitHubContext — sidebar PR list, socket `github:pr-checks` |
| **pr-ops** | 8 | merge, close, create, edit, rename, requestReview | MergeDialog, EditPRDialog, ReReviewDialog, command palette |
| **comments** | 6 | addComment, replyToReview, editIssueComment, editReviewComment, editReview | PRStatusContent — discussion timeline, ReplyDialog, EditCommentDialog |
| **reactions** | 2 | addReaction, removeReaction | PRStatusContent — emoji reaction badges |
| **webhooks** | 10 | ngrok init/stop, webhook CRUD, signature verify, validation polling, secret management | CreateTerminalModal (webhook setup), no direct UI for most |

Plus `repos` and `conductor` queries used only by CreateTerminalModal for repo selection.

### git (22 functions) and logs (3 functions)

Small enough to not need sub-groups.
