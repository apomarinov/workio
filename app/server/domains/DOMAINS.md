# Domain Refactoring Plan

## Dependencies

| Domain | Imports from | Why |
|---|---|---|
| **workspace** | — | Core entity, no domain deps |
| **git** | workspace, logs | Needs terminal cwd/ssh_host to run git; logs git commands |
| **sessions** | workspace, settings | Terminal/project lookups for backfill/move; settings for favorites |
| **github** | workspace, logs | Terminal tracking for branch detection; logs GitHub API calls |
| **logs** | workspace | `logCommand` reads terminal name/ssh_host via `getTerminalById` |
| **settings** | — | Standalone |
| **notifications** | — | Standalone |

```
workspace ← git
workspace ← sessions
workspace ← github
workspace ← logs
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
│   ├── queries.ts               (3 tRPC queries)
│   │   ├── list                      GET /api/terminals
│   │   ├── getById                   GET /api/terminals/:id
│   │   └── sshHosts                  GET /api/ssh/hosts
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
│       ├── shell.ts             (3 functions)
│       │   ├── writeShell
│       │   ├── interruptShell
│       │   └── killShell
│       └── system.ts            (9 functions)
│           ├── getParentAppName
│           ├── getParentAppNameCached
│           ├── isLocalPortAvailable
│           ├── browseFolder           GET /api/browse-folder
│           ├── openInIde              POST /api/open-in-ide
│           ├── openInExplorer         POST /api/open-in-explorer
│           ├── openFullDiskAccess     POST /api/open-full-disk-access
│           ├── listDirectories        POST /api/list-directories
│           └── sshAudit               GET /api/ssh/audit
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
| **workspace** | 19 | 3 | 10 | 15 | 47 |
| **git** | 0 | 6 | 13 | 3 | 22 |
| **sessions** | 18 | 5 | 7 | 16 | 46 |
| **github** | 0 | 4 | 14 | 26 | 44 |
| **logs** | 1 | 2 | 0 | 0 | 3 |
