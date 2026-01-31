# Conductor + Git Repo Workspace — Implementation Plan

Two new features for terminal creation: **git repo cloning** (clone a GitHub repo into a managed workspace directory) and **conductor** (run automated setup/archive scripts from `conductor.json` in the repo root).

## Table of Contents

- [Key Decisions](#key-decisions)
- [Database Changes](#database-changes)
- [Type Changes](#type-changes)
- [Server: Workspace Module](#server-workspace-module)
- [Server: Route Changes](#server-route-changes)
- [Server: Socket Events](#server-socket-events)
- [Client: API Layer](#client-api-layer)
- [Client: Create Terminal Modal](#client-create-terminal-modal)
- [Client: Terminal Context](#client-terminal-context)
- [Client: Terminal Item](#client-terminal-item)
- [Client: Terminal Shell Gating](#client-terminal-shell-gating)
- [File Change Summary](#file-change-summary)
- [Lifecycle Diagrams](#lifecycle-diagrams)

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| Clone path | `~/repo-workspaces/REPO_SLUG/RANDOM_SLUG/` |
| Path field | Hidden when git_repo selected; `cwd` auto-set to clone target |
| Slug generation | Inline word lists (~100 adjectives + ~100 nouns), no new packages |
| Conductor scope | Only available with a git repo (needs `conductor.json` from cloned repo) |
| SSH clone format | User enters `org/repo`, server constructs `git@github.com:org/repo.git` |
| conductor.json | Implement `setup` + `archive` only (skip `run` for now) |
| DB strategy | No migrations — modify `schema.sql` directly (per CLAUDE.md) |
| Async pattern | Fire-and-forget (match existing `detectGitBranch`/`refreshPRChecks` patterns) |
| New packages | None |

---

## Database Changes

**File: `schema.sql`**

Add two JSONB columns to the `terminals` table:

```sql
CREATE TABLE IF NOT EXISTS terminals (
    id SERIAL PRIMARY KEY,
    cwd TEXT NOT NULL,
    name VARCHAR(255),
    shell VARCHAR(255),
    ssh_host VARCHAR(255),
    pid INTEGER,
    status VARCHAR(10) DEFAULT 'running',
    active_cmd TEXT,
    git_branch VARCHAR(255),
    git_repo JSONB,                          -- NEW
    conductor JSONB,                         -- NEW
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Column shapes

**`git_repo`** — tracks clone state:
```ts
{
  repo: string          // "org/repo" short form
  status: 'setup' | 'done' | 'failed'
  error?: string        // set when status = 'failed'
}
```

**`conductor`** — tracks setup/archive state:
```ts
{
  enabled: boolean
  status: 'setup' | 'done' | 'failed' | 'archive'
  error?: string        // set when status = 'failed'
}
```

Both columns are nullable. A terminal with `git_repo = null` behaves exactly like today.

---

## Type Changes

**File: `app/src/types.ts`**

Extend the `Terminal` interface:

```ts
export interface GitRepoStatus {
  repo: string
  status: 'setup' | 'done' | 'failed'
  error?: string
}

export interface ConductorStatus {
  enabled: boolean
  status: 'setup' | 'done' | 'failed' | 'archive'
  error?: string
}

export interface Terminal {
  id: number
  cwd: string
  name: string | null
  shell: string | null
  ssh_host: string | null
  pid: number | null
  status: 'running' | 'stopped'
  active_cmd: string | null
  git_branch: string | null
  git_repo: GitRepoStatus | null          // NEW
  conductor: ConductorStatus | null       // NEW
  orphaned?: boolean
  created_at: string
  updated_at: string
}
```

---

## Server: Workspace Module

**New file: `app/server/workspace/setup.ts`**

### Slug generation

Inline word lists — ~100 adjectives, ~100 nouns. Function picks one of each at random:

```ts
function generateSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}
```

Produces slugs like `happy-penguin`, `swift-falcon`, `bright-meadow`.

### Repo slug

Derive from repo short form: `org/my-project` → `my-project`.

```ts
function repoSlug(repo: string): string {
  return repo.split('/').pop()!
}
```

### Clone path construction

```ts
const base = path.join(os.homedir(), 'repo-workspaces', repoSlug(repo), slug)
// e.g. ~/repo-workspaces/my-project/happy-penguin/
```

### `setupTerminalWorkspace(terminalId, repo, conductorEnabled)`

Called fire-and-forget from the route handler. Sequential steps:

1. Generate slug, construct target path
2. `fs.mkdirSync(targetPath, { recursive: true })`
3. `git clone git@github.com:${repo}.git ${targetPath}` via `execFile`
4. Update terminal `cwd` in DB to `targetPath`
5. `gh api user` → extract `login` field for GitHub username
6. `git checkout -b ${ghUser}/${slug}` inside `targetPath`
7. Set `git_repo.status = 'done'` in DB
8. Emit `terminal:workspace` socket event
9. If `conductorEnabled`:
   a. Read `conductor.json` from repo root
   b. Run setup script: `execFile(setupScript, { cwd: targetPath })`
   c. Set `conductor.status = 'done'` in DB
   d. Emit `terminal:workspace` socket event

On any error at any step:
- Set relevant column status to `'failed'` with error message
- Emit `terminal:workspace` socket event

### `archiveTerminalWorkspace(terminalId)`

Called fire-and-forget from the delete route handler (only when conductor is present):

1. Fetch terminal from DB
2. Set `conductor.status = 'archive'` in DB, emit socket event
3. Read `conductor.json` from workspace
4. Run archive script: `execFile(archiveScript, { cwd: terminal.cwd })`
5. `fs.rmSync(terminal.cwd, { recursive: true, force: true })`
6. Delete terminal from DB
7. Emit `terminal:workspace` with `{ terminalId, deleted: true }`

On error:
- Set `conductor.status = 'failed'` with error, emit socket event
- Do **not** delete the terminal or workspace directory

### Child process execution

Use `util.promisify(child_process.execFile)` for simple commands. All commands inherit the user's shell environment.

```ts
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
const execFile = promisify(execFileCb)
```

### conductor.json format

```json
{
  "setup": "path/to/setup-script.sh",
  "archive": "path/to/archive-script.sh",
  "run": "...",
  "runScriptMode": "concurrent"
}
```

Only `setup` and `archive` are implemented. `run` and `runScriptMode` are ignored for now.

---

## Server: Route Changes

**File: `app/server/routes/terminals.ts`**

### POST /api/terminals — Create

Extend `CreateTerminalBody`:

```ts
interface CreateTerminalBody {
  cwd?: string
  name?: string
  shell?: string
  ssh_host?: string
  git_repo?: string       // NEW — "org/repo" short form
  conductor?: boolean     // NEW — enable conductor
}
```

New creation path when `git_repo` is provided:

1. Validate format: must match `owner/repo` pattern
2. Compute target `cwd` from `~/repo-workspaces/REPO_SLUG/SLUG/` (generate slug)
3. Create terminal in DB with:
   - `cwd` = target path (directory doesn't exist yet — OK, `orphaned` flag handles this gracefully in UI)
   - `git_repo` = `{ repo, status: 'setup' }`
   - `conductor` = `{ enabled: true, status: 'setup' }` if requested
4. Return terminal to client immediately (201)
5. Fire `setupTerminalWorkspace(terminal.id, repo, conductor)` without await — `.catch(err => log.error(...))`

Existing local/SSH creation paths remain unchanged.

### DELETE /api/terminals/:id — Delete

Before deleting, check if terminal has `conductor` with a non-null status:

- **With conductor**: Set `conductor.status = 'archive'`, return 202 immediately, fire `archiveTerminalWorkspace(id)` async
- **Without conductor but with git_repo**: `fs.rmSync` workspace directory, then delete normally (existing flow)
- **Plain terminal**: Existing flow unchanged

### `db.ts` changes

Add `git_repo` and `conductor` params to `createTerminal`:

```ts
export async function createTerminal(
  cwd: string,
  name: string | null,
  shell: string | null = null,
  ssh_host: string | null = null,
  git_repo: object | null = null,       // NEW
  conductor: object | null = null,      // NEW
): Promise<Terminal> {
  const { rows } = await pool.query(
    `INSERT INTO terminals (cwd, name, shell, ssh_host, git_repo, conductor)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [cwd, name, shell, ssh_host,
     git_repo ? JSON.stringify(git_repo) : null,
     conductor ? JSON.stringify(conductor) : null],
  )
  return rows[0]
}
```

Add `git_repo` and `conductor` to `updateTerminal` accepted fields:

```ts
if (updates.git_repo !== undefined) {
  setClauses.push(`git_repo = $${paramIdx++}`)
  values.push(JSON.stringify(updates.git_repo))
}
if (updates.conductor !== undefined) {
  setClauses.push(`conductor = $${paramIdx++}`)
  values.push(JSON.stringify(updates.conductor))
}
```

---

## Server: Socket Events

**New event: `terminal:workspace`**

Emitted from `workspace/setup.ts` via `getIO()?.emit(...)`.

### Payload shape

```ts
interface WorkspaceEvent {
  terminalId: number
  git_repo?: GitRepoStatus    // current state after update
  conductor?: ConductorStatus // current state after update
  deleted?: boolean           // true when archive completes and terminal is removed
}
```

### Emission points

| When | Payload |
|------|---------|
| Clone completes | `{ terminalId, git_repo: { repo, status: 'done' } }` |
| Clone fails | `{ terminalId, git_repo: { repo, status: 'failed', error } }` |
| Conductor setup completes | `{ terminalId, conductor: { enabled: true, status: 'done' } }` |
| Conductor setup fails | `{ terminalId, conductor: { enabled: true, status: 'failed', error } }` |
| Archive starts | `{ terminalId, conductor: { enabled: true, status: 'archive' } }` |
| Archive completes + deleted | `{ terminalId, deleted: true }` |
| Archive fails | `{ terminalId, conductor: { enabled: true, status: 'failed', error } }` |

---

## Client: API Layer

**File: `app/src/lib/api.ts`**

Extend `createTerminal` to accept optional git_repo and conductor:

```ts
export async function createTerminal(
  cwd: string,
  name?: string,
  shell?: string,
  ssh_host?: string,
  git_repo?: string,
  conductor?: boolean,
): Promise<Terminal> {
  const res = await fetch(`${API_BASE}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, name, shell, ssh_host, git_repo, conductor }),
  })
  // ... existing error handling
}
```

---

## Client: Create Terminal Modal

**File: `app/src/components/CreateTerminalModal.tsx`**

### New state

```ts
const [gitRepo, setGitRepo] = useState('')
const [conductorEnabled, setConductorEnabled] = useState(false)
```

### UI changes

1. Add "Git Repo" input field (above Path):
   - Icon: `GitBranch` from lucide-react
   - Placeholder: `org/repo`
   - Helper text: "Clones via SSH into ~/repo-workspaces/"

2. When `gitRepo` is non-empty:
   - **Hide** the Path field (cwd is auto-computed)
   - Show **Conductor** toggle (Switch component from shadcn)
   - Label: "Run conductor setup"
   - Helper text: "Runs setup script from conductor.json in repo root"

3. On submit:
   - If `gitRepo` is set: pass `git_repo` and `conductor` to `createTerminal`, pass `cwd` as empty/`~` (server overrides)
   - If `gitRepo` is empty: existing behavior

### Validation

- `gitRepo` must match `/^[\w.-]+\/[\w.-]+$/` (basic owner/repo pattern)
- Conductor checkbox only visible when `gitRepo` is non-empty

---

## Client: Terminal Context

**File: `app/src/context/TerminalContext.tsx`**

### Subscribe to `terminal:workspace`

```ts
useEffect(() => {
  return subscribe<WorkspaceEvent>('terminal:workspace', (data) => {
    if (data.deleted) {
      mutate((prev) => prev?.filter((t) => t.id !== data.terminalId), false)
      return
    }
    mutate((prev) =>
      prev?.map((t) => {
        if (t.id !== data.terminalId) return t
        return {
          ...t,
          ...(data.git_repo && { git_repo: data.git_repo }),
          ...(data.conductor && { conductor: data.conductor }),
        }
      }),
    false)
  })
}, [subscribe, mutate])
```

### Extend `createTerminal` callback

Add `git_repo` and `conductor` params to match the updated API:

```ts
const createTerminal = useCallback(
  async (
    cwd: string,
    name?: string,
    shell?: string,
    ssh_host?: string,
    git_repo?: string,
    conductor?: boolean,
  ) => {
    const terminal = await api.createTerminal(cwd, name, shell, ssh_host, git_repo, conductor)
    mutate((prev) => (prev ? [terminal, ...prev] : [terminal]), false)
    return terminal
  },
  [mutate],
)
```

Update `TerminalContextValue` interface to match.

---

## Client: Terminal Item

**File: `app/src/components/TerminalItem.tsx`**

### Status display

Show setup/archive progress inline below the terminal name:

```tsx
{terminal.git_repo?.status === 'setup' && (
  <span className="text-xs text-blue-400">Cloning repository...</span>
)}
{terminal.git_repo?.status === 'failed' && (
  <span className="text-xs text-destructive">Clone failed: {terminal.git_repo.error}</span>
)}
{terminal.conductor?.status === 'setup' && (
  <span className="text-xs text-blue-400">Running conductor setup...</span>
)}
{terminal.conductor?.status === 'failed' && (
  <span className="text-xs text-destructive">Conductor failed: {terminal.conductor.error}</span>
)}
{terminal.conductor?.status === 'archive' && (
  <span className="text-xs text-yellow-500">Archiving workspace...</span>
)}
```

### Action gating

Disable the terminal click handler (selecting/connecting) while `git_repo.status === 'setup'` or `conductor.status === 'setup'`. The user can still delete a stuck terminal.

---

## Client: Terminal Shell Gating

**File: `app/src/components/Terminal.tsx`** (or wherever PTY connection is initiated)

Gate PTY session creation: don't connect to the terminal's shell if `git_repo.status === 'setup'` or `conductor.status === 'setup'`. Show a placeholder message like "Setting up workspace..." instead of the xterm terminal.

Once status transitions to `'done'`, the socket event triggers a state update and the terminal component can auto-connect.

---

## File Change Summary

| File | Action | What changes |
|------|--------|-------------|
| `schema.sql` | Modify | Add `git_repo JSONB` and `conductor JSONB` columns to terminals |
| `app/src/types.ts` | Modify | Add `GitRepoStatus`, `ConductorStatus` interfaces; extend `Terminal` |
| `app/server/workspace/setup.ts` | **Create** | Async job runner: slug gen, clone, branch, conductor setup/archive |
| `app/server/db.ts` | Modify | Update `createTerminal` and `updateTerminal` for new columns |
| `app/server/routes/terminals.ts` | Modify | Handle `git_repo`/`conductor` in create; async archive in delete |
| `app/src/lib/api.ts` | Modify | Add `git_repo`, `conductor` params to `createTerminal` |
| `app/src/components/CreateTerminalModal.tsx` | Modify | Git repo input, conductor toggle, hide path when repo set |
| `app/src/context/TerminalContext.tsx` | Modify | Subscribe to `terminal:workspace`, extend `createTerminal` signature |
| `app/src/components/TerminalItem.tsx` | Modify | Status indicators, action gating during setup/archive |
| `app/src/components/Terminal.tsx` | Modify | Gate PTY connection while workspace is setting up |

---

## Lifecycle Diagrams

### Create with git repo + conductor

```
Client                    Server (route)              Server (async job)
  │                           │                            │
  ├─ POST /api/terminals ────►│                            │
  │  { git_repo: "o/r",      │                            │
  │    conductor: true }      │                            │
  │                           ├─ INSERT terminal ──────────┤
  │                           │  git_repo.status='setup'   │
  │                           │  conductor.status='setup'  │
  │◄── 201 { terminal } ─────┤                            │
  │                           ├─ fire-and-forget ─────────►│
  │                           │                            ├─ mkdir
  │                           │                            ├─ git clone
  │                           │                            ├─ gh api user
  │                           │                            ├─ git checkout -b
  │                           │                            ├─ UPDATE git_repo.status='done'
  │◄──── ws: terminal:workspace ──────────────────────────┤
  │      { terminalId, git_repo: {status:'done'} }        │
  │                           │                            ├─ read conductor.json
  │                           │                            ├─ exec setup script
  │                           │                            ├─ UPDATE conductor.status='done'
  │◄──── ws: terminal:workspace ──────────────────────────┤
  │      { terminalId, conductor: {status:'done'} }       │
  │                           │                            │
  │  [PTY connection now allowed]                          │
```

### Delete with conductor archive

```
Client                    Server (route)              Server (async job)
  │                           │                            │
  ├─ DELETE /terminals/:id ──►│                            │
  │                           ├─ UPDATE conductor='archive'│
  │◄── 202 ──────────────────┤                            │
  │                           ├─ fire-and-forget ─────────►│
  │◄──── ws: terminal:workspace ──────────────────────────┤
  │      { terminalId, conductor: {status:'archive'} }    │
  │                           │                            ├─ read conductor.json
  │                           │                            ├─ exec archive script
  │                           │                            ├─ rm -rf workspace
  │                           │                            ├─ DELETE terminal
  │◄──── ws: terminal:workspace ──────────────────────────┤
  │      { terminalId, deleted: true }                    │
```

### Error recovery

If setup or archive fails, the terminal remains in the DB with `status: 'failed'` and an error message. The user can:

1. **Delete** the terminal (skips conductor archive if setup never completed)
2. View the error in the sidebar

There is no retry mechanism in this initial implementation. A failed workspace can be manually cleaned up or deleted.
