# Client Architecture Refactoring Plan

## Goal

Replace 9 nested context providers with Zustand stores, introduce a typed action layer with centralized loading/error tracking, centralize socket event routing, and eliminate 49+ untyped DOM events.

## Architecture

```
UI Layer        — Components read stores + call actions. No tRPC, no socket, no DOM events.
Action Layer    — tracked() functions that perform mutations, track loading, show toasts.
Stores          — Zustand. Pure state + selectors + simple setters. No side effects.
Services        — Socket manager, data sync. Runs once at startup, updates stores/queryClient.
Data Layer      — tRPC + React Query (unchanged). Actions call it. Services read from it.
```

### Store split

| Store | Contents | Replaces |
|---|---|---|
| `uiStore` | settings panel mode/target, bottom panel visible/tab/filter, dialogCount, paletteMode, modals map | UIStateContext, BottomPanelContext |
| `workspaceUIStore` | activeTerminalId, activeShells, collapsedProjectRepos, mountAllShellsTerminalId | WorkspaceContext (UI slice) |
| `runtimeStore` | processes, ports, portForwardStatus, resourceInfo, gitDirtyStatus, gitRemoteSyncStatus, gitLastCommit, bellShellIds, shellClients, servicesStatus | ProcessContext + WorkspaceContext (runtime slice) |
| `githubRuntimeStore` | githubPRs (socket-fed), ghUsername, activePR, prPoll | GitHubContext |
| `actionStore` | pending Map, errors Map, execute/isPending/isAnyPending | New |

### React Query (unchanged)

Terminals, sessions, notifications, settings, logs, branches, changed files, closedPRs, involvedPRs.

### Socket manager handler styles

| Style | Target | Example events |
|---|---|---|
| `runtimeHandler` | Zustand store write | `processes`, `git:dirty-status`, `git:remote-sync`, `services:status`, `shell:clients`, `github:pr-checks`, `pty:bell`, `bell:subscriptions`, `bell:notify` |
| `cachePatchHandler` | `queryClient.setQueryData()` | `terminal:updated`, `shell:updated`, `terminal:workspace`, `session:updated`, `sessions_deleted`, `notifications:new` |
| `cacheRefreshHandler` | `queryClient.invalidateQueries()` | `refetch`, `hook`, `session_update` |

### Event survival

Only ~6 imperative signals survive as typed bus events. Everything else becomes direct store/action calls.

| Survives on bus | Reason |
|---|---|
| `terminal-focus` | One-shot command to mounted xterm instance |
| `terminal-paste` | One-shot command to mounted xterm instance |
| `claim-primary` / `release-primary` | Shell tab ↔ Terminal imperative handshake |
| `primary-status` | Terminal → ShellTabs imperative response |
| `flash-session` | Pure visual effect (CSS animation trigger) |

---

## Step 1: Action store + tracked() infrastructure

**Risk: None** (pure addition, no changes to existing code)

### New files

#### `app/src/stores/actionStore.ts`

Central loading/error tracking store.

```ts
interface ActionEntry { key: string; startedAt: number; count: number }

interface ActionState {
  pending: Map<string, ActionEntry>
  errors: Map<string, Error>
  execute: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  isPending: (key: string) => boolean
  isAnyPending: (...prefixes: string[]) => boolean
  getError: (key: string) => Error | undefined
  clearError: (key: string) => void
}
```

- Track counts (not booleans) so concurrent same-key actions work
- `execute()` increments count on start, decrements on finish, sets error on failure
- `isAnyPending(...prefixes)` checks if any key starts with any prefix
- Calls `toastError()` on failure (centralized error handling)

#### `app/src/stores/tracked.ts`

Factory that wraps async functions with action tracking.

```ts
type TrackedFn<Id extends string, Args extends unknown[], R> =
  ((...args: Args) => Promise<R>) & { actionId: Id; domain: string }

function tracked<Id extends string, Args extends unknown[], R>(
  id: Id,
  fn: (...args: Args) => Promise<R>
): TrackedFn<Id, Args, R>
```

- Attaches `.actionId` and `.domain` (derived from prefix before first `.`)
- Internally calls `actionStore.getState().execute(id, () => fn(...args))`
- Components use `useActionPending(github.mergePR)` — reads `.actionId`, no string construction

#### `app/src/stores/hooks.ts`

React hooks for consuming action state.

```ts
function useActionPending(action: { actionId: string }): boolean
function useActionPendingDomain(domain: string): boolean
function useAnyActionPending(): boolean
function useActionError(action: { actionId: string }): Error | undefined
```

#### `app/src/actions/workspace.ts`

First domain action module. Start by wrapping the 3 WorkspaceContext mutations:

- `workspace.createTerminal(opts)` — calls `api.workspace.terminals.createTerminal.mutate()`, invalidates terminal list query, shows toast
- `workspace.updateTerminal(id, updates)` — calls mutate, patches query cache
- `workspace.deleteTerminal(id)` — optimistic removal from query cache, calls mutate, rolls back on error

#### `app/src/actions/index.ts`

Re-exports all domain action modules.

```ts
export { workspace } from './workspace'
// Future: github, git, sessions, notifications, settings, webhooks
```

### Files modified

- **`app/src/lib/api.ts`** — No changes yet. Existing wrapper functions continue to work. Actions will gradually replace these.

### Validation

- Import `actionStore` in a test component, call a tracked action, verify `useActionPending()` returns true during execution and false after.
- Verify `useActionPendingDomain('workspace')` works.
- Run `npm run check` to verify no type errors.

---

## Step 2: uiStore (merge UIStateContext + BottomPanelContext + dialog count + palette state)

**Risk: Low** — these are the smallest contexts with fewest consumers

### New files

#### `app/src/stores/uiStore.ts`

```ts
interface UIState {
  // Settings panel (from UIStateContext)
  settings: {
    mode: 'focused' | 'open' | undefined
    target: string[] | null
    open: (target?: string[]) => void
    focus: () => void
    unfocus: () => void
    close: () => void
    clearTarget: () => void
  }

  // Bottom panel (from BottomPanelContext)
  bottomPanel: {
    loaded: boolean
    visible: boolean
    tab: BottomPanelTab | undefined
    logsFilter: LogsInitialFilter | undefined
    open: (tab?: BottomPanelTab) => void
    toggle: (tab?: BottomPanelTab) => void
    close: () => void
    clearLogsFilter: () => void
  }

  // Dialog tracking (from useKeyboardShortcuts event listeners)
  dialog: {
    count: number
    increment: () => void
    decrement: () => void
  }

  // Palette state — null means closed, non-null means open.
  // Defined here so step 3 just uses it, no redundant boolean.
  palette: {
    mode: PaletteMode | null
    open: (mode?: PaletteMode) => void
    close: () => void
  }

  // Modal state — define the modals map here so step 3 only adds keys, not a new structure.
  // commitDialog lives here instead of a separate boolean.
  modals: {
    commitDialog: { terminalId: number } | null
    // Step 3 adds: terminal, prModal, branchCommits, sessionSearch, portMapping, templateModal, filePicker, customAction, mobileKeyboardCustomize
  }
  openModal: (key: ModalKey, config: any) => void
  closeModal: (key: ModalKey) => void

  // Shortcuts disabled (from KeymapView event)
  shortcuts: {
    disabled: boolean
    setDisabled: (disabled: boolean) => void
  }
}
```

### Files modified

#### Remove UIStateContext — 7 consumers

| File | Change |
|---|---|
| `src/context/UIStateContext.tsx` | **Delete entirely** |
| `src/App.tsx` | Remove `UIStateProvider` from provider tree. Replace `useUIState()` with `useUIStore()` |
| `src/components/AppKeyboardShortcuts.tsx` | Replace `useUIState()` with `useUIStore()` |
| `src/components/MobileLayout.tsx` | Replace `useUIState()` with `useUIStore()` |
| `src/components/ServiceStatusIndicator.tsx` | Replace `useUIState()` with `useUIStore()` |
| `src/components/settings/SettingsViewContext.tsx` | Replace `useUIState()` with `useUIStore()` |
| `src/components/ShellTabs.tsx` | Replace `useUIState()` with `useUIStore()` |
| `src/components/Sidebar.tsx` | Replace `useUIState()` with `useUIStore()` |

#### Remove BottomPanelContext — 3 consumers

| File | Change |
|---|---|
| `src/context/BottomPanelContext.tsx` | **Delete entirely** |
| `src/App.tsx` | Remove `BottomPanelProvider` from provider tree |
| `src/components/bottom-panel/tabs/logs/LogsContext.tsx` | Replace `useBottomPanel()` with `useUIStore()` |
| `src/components/BottomPanelLoader.tsx` | Replace `useBottomPanel()` with `useUIStore()` |

#### Remove DOM events absorbed into uiStore

These events become direct store calls:

| Event | Dispatched from | Listened in | Replacement |
|---|---|---|---|
| `settings-open` | UIStateContext.tsx:43 | SessionContext.tsx:68, MobileLayout.tsx:71 | Zustand `subscribe()` on `settingsMode` changes |
| `toggle-bottom-panel` | StatusBar.tsx:382 | App.tsx:93, BottomPanelContext.tsx:50 | `useUIStore.getState().bottomPanel.toggle()` |
| `open-logs` | search.tsx:201, pr-actions.tsx:241 | App.tsx:94, BottomPanelContext.tsx:65 | `useUIStore.getState().bottomPanel.open('logs')` + set filter |
| `dialog-opened` | dialog.tsx (Radix) | useKeyboardShortcuts.tsx:298 | `useUIStore.getState().dialog.increment()` |
| `dialog-closed` | AppModals.tsx, SessionSearchPanel.tsx, CommandPalette.tsx | useKeyboardShortcuts.tsx:299,628 | `useUIStore.getState().dialog.decrement()` |
| `palette-state` | CommandPalette.tsx:487,493,564,571 | useKeyboardShortcuts.tsx:31, SessionSearchPanel.tsx:236 | `useUIStore.getState().palette.open()` / `palette.close()` |
| `commit-dialog-open` | CommitDialog.tsx:86,92 | useKeyboardShortcuts.tsx:297 | `useUIStore.getState().openModal('commitDialog', ...)` / `closeModal('commitDialog')` |
| `shortcuts-disabled` | KeymapView.tsx:189,193 | useKeyboardShortcuts.tsx:296 | `useUIStore.getState().shortcuts.setDisabled()` |

#### Modify useKeyboardShortcuts.tsx

Remove the following event listeners and replace with store reads:
- `dialog-opened` / `dialog-closed` → read `uiStore.dialog.count`
- `palette-state` → read `uiStore.palette.mode !== null`
- `commit-dialog-open` → read `uiStore.modals.commitDialog !== null`
- `shortcuts-disabled` → read `uiStore.shortcuts.disabled`

The module-level `paletteState` variable (useKeyboardShortcuts.tsx:25) and the `dialogOpenCountRef` / `commitDialogOpenRef` refs can be replaced with `useUIStore.getState()` calls inside hotkey callbacks (Zustand getState is synchronous, no stale closure issues).

#### Modify Dialog component (src/components/ui/dialog.tsx)

Replace `window.dispatchEvent(new Event('dialog-opened'))` with `useUIStore.getState().dialog.increment()`. Same for close.

#### SessionContext.tsx

Replace `window.addEventListener('settings-open', ...)` with a Zustand subscription:

```ts
useEffect(() => {
  return useUIStore.subscribe(
    (s) => s.settings.mode,
    (mode, prev) => { if (mode && !prev) clearSession() }
  )
}, [])
```

### Events killed in this step: 8

`settings-open`, `toggle-bottom-panel`, `open-logs`, `dialog-opened`, `dialog-closed`, `palette-state`, `commit-dialog-open`, `shortcuts-disabled`

### Providers removed: 2

`UIStateProvider`, `BottomPanelProvider`

---

## Step 3: Replace low-risk coordination events with direct store/action calls

**Risk: Low** — mechanical event→action replacements

### Events to kill in this step

#### Modal/dialog open events → uiStore methods

Extend the `modals` map and `openModal`/`closeModal` methods already defined in step 2 with the remaining modal keys:

```ts
// Extend modals map (commitDialog already defined in step 2)
modals: {
  commitDialog: { terminalId: number } | null       // (from step 2)
  terminal: TerminalModalConfig | null
  prModal: PRModalConfig | null
  branchCommits: BranchCommitsConfig | null
  sessionSearch: SessionSearchConfig | null
  portMapping: PortMappingConfig | null
  templateModal: TemplateModalConfig | null
  filePicker: FilePickerConfig | null
  customAction: CustomActionConfig | null
  mobileKeyboardCustomize: MobileKeyboardConfig | null
}
```

| Event | Replacement |
|---|---|
| `open-terminal-modal` | `uiStore.openModal('terminal', config)` |
| `open-commit-dialog` | `uiStore.openModal('commitDialog', config)` |
| `open-pr-modal` | `uiStore.openModal('prModal', config)` |
| `open-branch-commits` | `uiStore.openModal('branchCommits', config)` |
| `open-session-search` | `uiStore.openModal('sessionSearch', config)` |
| `open-port-mapping` | `uiStore.openModal('portMapping', config)` |
| `open-template-modal` | `uiStore.openModal('templateModal', config)` |
| `open-file-picker` | `uiStore.openModal('filePicker', config)` |

#### Palette/command events → uiStore methods

Use the `palette.mode` / `palette.open()` / `palette.close()` methods already defined in step 2:

| Event | Replacement |
|---|---|
| `open-palette` | `uiStore.palette.open(mode)` |
| `open-shell-templates` | `uiStore.palette.open('shell-templates')` |
| `open-custom-commands` | `uiStore.palette.open('custom-commands')` |
| `open-terminal-branches` | `uiStore.palette.open('branches')` |
| `open-branch-actions` | `uiStore.palette.open('branch-actions')` |
| `open-item-actions` | `uiStore.palette.open('item-actions')` |

#### UI toggle events → uiStore methods

| Event | Replacement |
|---|---|
| `toggle-sidebar` | `uiStore.sidebar.toggle()` |
| `toggle-pip` | `uiStore.pip.toggle()` (or action if PiP has async logic) |
| `collapse-all` | `uiStore.sidebar.collapseAll()` |
| `open-settings` | `uiStore.settings.open(target)` |
| `open-create-custom-action` | `uiStore.openModal('customAction', config)` |

#### Sidebar reveal events → uiStore methods

| Event | Replacement |
|---|---|
| `reveal-terminal` | `uiStore.sidebar.revealTerminal(id)` — sets activeTerminalId + scrolls sidebar |
| `reveal-session` | `uiStore.sidebar.revealSession(id)` — sets activeSessionId + scrolls sidebar |
| `reveal-pr` | `uiStore.sidebar.revealPR(owner, repo, number)` — opens sidebar PR section |

#### Other UI events → store methods

| Event | Replacement |
|---|---|
| `terminal-activity` | `runtimeStore.markTerminalActivity(id)` |
| `mobile-keyboard-customize` | `uiStore.openModal('mobileKeyboardCustomize', config)` |

#### Commit dialog internal events → uiStore methods

| Event | Replacement |
|---|---|
| `commit-toggle-amend` | `uiStore.commit.toggleAmend()` |
| `commit-toggle-no-verify` | `uiStore.commit.toggleNoVerify()` |

#### Orphaned events — delete dispatches (no listeners exist)

| Event | Action |
|---|---|
| `local-storage-sync` | Delete the dispatch — no listener exists |
| `shell-template-run` | Delete the dispatch — no listener exists |

### Files modified

| File | Changes |
|---|---|
| `src/components/AppModals.tsx` | Read modal state from `uiStore` instead of 8 `addEventListener` calls |
| `src/components/AppKeyboardShortcuts.tsx` | Replace ~15 `dispatchEvent` calls with direct `uiStore` method calls |
| `src/components/command-palette/CommandPalette.tsx` | Read palette mode from `uiStore.palette.mode`. Remove `open-palette` listener. Replace `open-*` dispatches with `uiStore.palette.open()` |
| `src/components/Sidebar.tsx` | Remove 7 `addEventListener` calls. Replace `dispatchEvent` calls with `uiStore` methods |
| `src/components/StatusBar.tsx` | Replace `dispatchEvent('toggle-bottom-panel')`, `dispatchEvent('open-commit-dialog')` etc. with store calls |
| `src/components/CommitDialog.tsx` | Replace `dispatchEvent('commit-dialog-open')` with `uiStore.openModal('commitDialog', ...)` / `closeModal('commitDialog')`. Remove `commit-toggle-*` listeners, read from store |
| `src/components/SessionSearchPanel.tsx` | Remove `palette-state` listener, read from `uiStore` |
| `src/components/SessionItem.tsx` | Replace `dispatchEvent('open-item-actions')` with `uiStore.palette.open('item-actions')` |
| `src/components/PRStatusContent.tsx` | Replace `dispatchEvent('open-pr-modal')` with `uiStore.openModal('prModal')` |
| `src/components/terminal-status-sections.tsx` | Replace `dispatchEvent('open-port-mapping')` with `uiStore.openModal('portMapping')` |
| `src/components/settings/controls/ShellTemplateSetting.tsx` | Replace `dispatchEvent('open-template-modal')` with `uiStore.openModal('templateModal')` |
| `src/components/command-palette/modes/*.tsx` | Replace event dispatches with store calls |
| `src/components/DesktopLayout.tsx` | Remove `toggle-sidebar` listener, subscribe to `uiStore.sidebar.collapsed` |
| `src/components/MobileLayout.tsx` | Same sidebar change |
| `src/components/ShellTabs.tsx` | Replace `shell-close`, `shell-template-request` listeners — these move to step 5 (shell actions) |
| `src/components/settings/KeymapView.tsx` | Replace `dispatchEvent('shortcuts-disabled')` with `uiStore.shortcuts.setDisabled()` |

### Events killed in this step: ~32

All `open-*`, `toggle-*`, `collapse-all`, `commit-toggle-*`, `palette-select-index`, `reveal-*`, `terminal-activity`, `mobile-keyboard-customize` events. Plus 2 orphaned events deleted (`local-storage-sync`, `shell-template-run`).

### Running total events killed: ~40 of 49

---

## Step 3.5: Extract notification service (prerequisite for step 4)

**Risk: Low** — pure extraction, no consumer changes

### Problem

`ProcessContext.tsx` imports `useNotifications` from `NotificationContext` to play bell sounds and send OS notifications. Step 4 deletes `ProcessContext` and moves bell/notification logic into `socketManager.ts`, but `NotificationContext` isn't refactored until step 8. The socket manager can't depend on a React context.

### Solution

Extract the imperative browser notification logic from `NotificationContext.tsx` into a plain module:

#### `app/src/services/notifications.ts`

```ts
// Extracted from NotificationContext — no React dependency
export const notificationService = {
  requestPermission: async () => { ... },
  showNotification: (title: string, opts?: NotificationOptions) => { ... },
  playSound: (sound: string) => { ... },
  getPermissionStatus: () => Notification.permission,
  subscribeToPush: async (vapidKey: string) => { ... },
  unsubscribeFromPush: async () => { ... },
}
```

### Files modified

| File | Change |
|---|---|
| `src/context/NotificationContext.tsx` | Import from `services/notifications.ts` instead of owning the logic. Becomes a thin React wrapper — existing consumers still work unchanged |

### Validation

- `notificationService.showNotification()` works when imported directly (no React context needed)
- All existing `useNotifications()` consumers still work
- `npm run check` passes

---

## Step 4: runtimeStore + socket manager

**Risk: Medium** — extracting socket subscriptions from contexts

### New files

#### `app/src/stores/runtimeStore.ts`

```ts
interface RuntimeState {
  // From ProcessContext
  processes: ActiveProcess[]
  terminalPorts: Record<number, number[]>
  shellPorts: Record<number, number[]>
  portForwardStatus: Record<number, PortForwardStatus[]>
  resourceInfo: ResourceInfo
  gitDirtyStatus: Record<number, GitDiffStat>
  gitRemoteSyncStatus: Record<number, { behind: number; ahead: number; noRemote: boolean }>
  gitLastCommit: Record<number, GitLastCommit>
  bellShellIds: Set<number>

  // From WorkspaceContext (runtime slice)
  shellClients: Map<number, ShellClient[]>
  servicesStatus: ServicesStatus | null

  // Setters (called by socket manager)
  updateProcesses: (payload: ProcessesPayload) => void
  updateGitDirtyStatus: (data: ...) => void
  updateGitRemoteSyncStatus: (data: ...) => void
  setShellClients: (shellId: number, clients: ShellClient[]) => void
  setServicesStatus: (status: ServicesStatus) => void
  // ... etc
}
```

#### `app/src/services/socketManager.ts`

Single initialization function. Called once from `App.tsx` or `main.tsx`.

```ts
import { runtimeStore } from '@/stores/runtimeStore'
import { queryClient } from '@/lib/queryClient'

export function initSocketManager(socket: Socket) {
  // --- Runtime handlers (→ store) ---
  socket.on('processes', (payload) => runtimeStore.getState().updateProcesses(payload))
  socket.on('git:dirty-status', (data) => runtimeStore.getState().updateGitDirtyStatus(data))
  socket.on('git:remote-sync', (data) => runtimeStore.getState().updateGitRemoteSyncStatus(data))
  socket.on('services:status', (status) => runtimeStore.getState().setServicesStatus(status))
  socket.on('shell:clients', (data) => runtimeStore.getState().setShellClients(data))
  socket.on('github:pr-checks', (data) => githubRuntimeStore.getState().setPRChecks(data))
  socket.on('pty:bell', (data) => { /* notificationService.playSound(), uses runtimeStore for subscription check */ })
  socket.on('bell:subscriptions', (data) => runtimeStore.getState().setBellSubscriptions(data))
  socket.on('bell:notify', (data) => { /* notificationService.showNotification() — extracted in step 3.5 */ })

  // --- Cache patch handlers (→ queryClient.setQueryData) ---
  socket.on('terminal:updated', ({ terminalId, data }) => {
    queryClient.setQueryData(['workspace', 'terminals', 'listTerminals'], (prev) =>
      prev?.map((t) => (t.id === terminalId ? { ...t, ...data } : t))
    )
  })
  socket.on('shell:updated', ({ shellId, data }) => { /* patch shell in terminal query */ })
  socket.on('terminal:workspace', (payload) => { /* handle create/delete/rename in query cache */ })
  socket.on('session:updated', (data) => { /* patch session in sessions query cache */ })
  socket.on('sessions_deleted', (ids) => { /* filter sessions query cache */ })
  socket.on('notifications:new', (data) => { /* patch notifications query cache + notificationService.showNotification() */ })
  socket.on('notification:custom', (data) => { /* notificationService.showNotification() only */ })

  // --- Cache refresh handlers (→ invalidateQueries) ---
  socket.on('refetch', ({ group }) => {
    const keyMap: Record<string, string[]> = {
      terminals: ['workspace', 'terminals'],
      sessions: ['sessions'],
      settings: ['settings'],
      notifications: ['notifications'],
    }
    const key = keyMap[group]
    if (key) queryClient.invalidateQueries({ queryKey: key })
  })
  socket.on('hook', (data) => { /* debounced session fetch or invalidate */ })
  socket.on('session_update', (data) => { /* debounced session fetch */ })
}
```

#### `app/src/lib/queryClient.ts`

Extract `queryClient` creation from `main.tsx` into its own module so both `main.tsx` and `socketManager.ts` can import it.

```ts
import { QueryClient } from '@tanstack/react-query'
export const queryClient = new QueryClient()
```

### New action files

#### `app/src/actions/process.ts`

```ts
export const process = {
  subscribeToBell: tracked('process.subscribeToBell', async (shellId, terminalId, command, terminalName) => {
    getSocket().emit('bell:subscribe', { shellId, terminalId, command, terminalName })
    runtimeStore.getState().addBellSubscription(shellId)
  }),
  unsubscribeFromBell: tracked('process.unsubscribeFromBell', async (shellId) => {
    getSocket().emit('bell:unsubscribe', { shellId })
    runtimeStore.getState().removeBellSubscription(shellId)
  }),
}
```

### Files modified

| File | Change |
|---|---|
| `src/context/ProcessContext.tsx` | **Delete entirely** |
| `src/App.tsx` | Remove `ProcessProvider` from provider tree. Call `initSocketManager(socket)` once. Import `queryClient` from new module |
| `src/main.tsx` | Import `queryClient` from `@/lib/queryClient` instead of creating inline |

#### Update ProcessContext consumers (9 files)

| File | Change |
|---|---|
| `src/components/AppKeyboardShortcuts.tsx` | Replace `useProcessContext()` with `useRuntimeStore()` selectors |
| `src/components/command-palette/CommandPalette.tsx` | Same |
| `src/components/ResourceInfo.tsx` | Same |
| `src/components/ShellTabs.tsx` | Same |
| `src/components/StatusBar.tsx` | Same |
| `src/components/terminal-status-sections.tsx` | Same |
| `src/components/TerminalItem.tsx` | Same |
| `src/hooks/useMountedShells.ts` | Same |

#### Partially update WorkspaceContext

Remove `shellClients` and `servicesStatus` state + their socket subscriptions. These now live in `runtimeStore` and are wired in `socketManager`. Update the 2 components that read them:

| File | Change |
|---|---|
| `src/components/ShellTabs.tsx` | Read `shellClients` from `runtimeStore` instead of workspace context |
| `src/components/ServiceStatusIndicator.tsx` | Read `servicesStatus` from `runtimeStore` instead of workspace context |

#### Move socket subscriptions out of WorkspaceContext

Remove these `subscribe()` calls from WorkspaceContext.tsx and move them to `socketManager.ts`:
- `terminal:updated` (line 192)
- `shell:updated` (line 210)
- `terminal:workspace` (line 239)
- `shell:clients` (line 274) → runtimeStore
- `services:status` → runtimeStore
- `refetch` for terminals (line 495)

#### Move socket subscriptions out of SessionContext

Remove these from SessionContext.tsx, move to socketManager:
- `hook` (line 105)
- `session_update` (line 115)
- `session:updated` (line 121)
- `sessions_deleted` (line 155)
- `refetch` for sessions (line 149)

#### Move socket subscriptions out of NotificationDataContext

Remove these, move to socketManager:
- `notifications:new` (line 74, 169)
- `notification:custom` (line 145)
- `refetch` for notifications (line 189)

### Providers removed: 1

`ProcessProvider`

### Socket subscriptions centralized: ~22 of 28

Remaining: `useSessionMessages` (1), `useActivePermissions` (2), `useShellActions` (1), `LogsContext` (1), `useNotificationSubscriptions` (2). These are fine to leave in hooks — they're scoped to specific mounted components.

---

## Step 5: workspaceUIStore (split out of WorkspaceContext)

**Risk: Medium-High** — most consumers (27 files)

### New files

#### `app/src/stores/workspaceUIStore.ts`

```ts
interface WorkspaceUIState {
  activeTerminalId: number | null
  activeShells: Record<number, number>  // terminalId → shellId
  collapsedProjectRepos: string[]
  mountAllShellsTerminalId: number | null

  // Setters
  setActiveTerminalId: (id: number | null) => void
  setActiveShell: (terminalId: number, shellId: number) => void
  setCollapsedProjectRepos: (repos: string[]) => void
  setMountAllShellsTerminalId: (id: number | null) => void
}

// With persist middleware for activeTerminalId
```

### New action files

#### `app/src/actions/workspace.ts` (extend from step 1)

Add remaining workspace actions:

```ts
export const workspace = {
  // From step 1
  createTerminal: tracked('workspace.createTerminal', async (opts) => { ... }),
  updateTerminal: tracked('workspace.updateTerminal', async (id, updates) => { ... }),
  deleteTerminal: tracked('workspace.deleteTerminal', async (id) => { ... }),

  // New
  selectTerminal: (id: number) => {
    workspaceUIStore.getState().setActiveTerminalId(id)
    bus.emit('terminal-focus', { terminalId: id })
  },
  clearTerminal: () => workspaceUIStore.getState().setActiveTerminalId(null),
  setTerminalOrder: tracked('workspace.setTerminalOrder', async (order) => {
    await api.settings.update.mutate({ terminal_order: order })
  }),
  mapPort: tracked('workspace.mapPort', async (terminalId, port, localPort) => {
    await api.workspace.terminals.mapPort.mutate({ terminalId, port, localPort })
  }),
  unmapPort: tracked('workspace.unmapPort', async (terminalId, port) => {
    await api.workspace.terminals.unmapPort.mutate({ terminalId, port })
  }),
}
```

#### `app/src/actions/shell.ts`

Extract from `useShellActions.ts` (17KB, the largest hook):

```ts
export const shell = {
  create: tracked('shell.create', async (terminalId, opts?) => { ... }),
  delete: tracked('shell.delete', async (terminalId, shellId) => { ... }),
  rename: tracked('shell.rename', async (shellId, name) => { ... }),
  split: tracked('shell.split', async (terminalId, shellId, direction) => { ... }),
  select: (terminalId: number, shellId: number) => {
    workspaceUIStore.getState().setActiveShell(terminalId, shellId)
    bus.emit('terminal-focus', { terminalId })
  },
  write: tracked('shell.write', async (shellId, data) => { ... }),
  interrupt: tracked('shell.interrupt', async (shellId) => { ... }),
  kill: tracked('shell.kill', async (shellId) => { ... }),
  saveTemplate: tracked('shell.saveTemplate', async (shellId, name) => { ... }),
}
```

### Shell events → direct action calls

| Event | Dispatched from | Replacement |
|---|---|---|
| `shell-select` | AppKeyboardShortcuts, TerminalItem, useActiveShells | `shell.select(terminalId, shellId)` |
| `shell-create` | AppKeyboardShortcuts | `shell.create(terminalId)` |
| `shell-split` | AppKeyboardShortcuts, ShellTabs | `shell.split(terminalId, shellId, direction)` |
| `shell-delete` | ShellTabs | `shell.delete(terminalId, shellId)` |
| `shell-rename` | TerminalItem | `shell.rename(shellId, name)` |
| `shell-close` | AppKeyboardShortcuts | `shell.delete(terminalId, shellId)` |
| `shell-template-run` | ShellTabs | `shell.runTemplate(terminalId, shellId, template)` |
| `shell-template-request` | ShellTabs | Move to uiStore modal state |

### Files modified

| File | Change |
|---|---|
| `src/context/WorkspaceContext.tsx` | **Delete entirely** |
| `src/App.tsx` | Remove `WorkspaceProvider`. Terminals query moves to a `useTerminalsQuery()` hook or stays in App for initial data |
| `src/hooks/useShellActions.ts` | **Delete entirely** — replaced by `actions/shell.ts` and `actions/workspace.ts`. Remove all 6 addEventListener calls |
| `src/hooks/useActiveShells.ts` | **Delete entirely** — logic absorbed into `workspaceUIStore` |
| `src/hooks/useMountedShells.ts` | Read from `workspaceUIStore` + `runtimeStore` instead of contexts |
| `src/hooks/useShellLastActive.ts` | May be absorbed into `workspaceUIStore` or kept as utility |

#### Update 27 WorkspaceContext consumers

Each file replaces `useWorkspaceContext()` with a combination of:
- `useWorkspaceUIStore()` for activeTerminalId, activeShells, collapsed groups
- `trpc.workspace.terminals.listTerminals.useQuery()` for terminal list (or a `useTerminals()` convenience hook)
- `useRuntimeStore()` for shellClients, servicesStatus
- Action calls for mutations

Key files and their specific changes:

| File | Context fields used | Replacement |
|---|---|---|
| `src/components/Sidebar.tsx` | terminals, activeTerminal, selectTerminal, collapsedProjectRepos, orderedTerminals | `useTerminals()` hook + `workspaceUIStore` + `workspace.selectTerminal()` |
| `src/components/Terminal.tsx` | (shell data) | `useTerminals()` + `workspaceUIStore` |
| `src/components/ShellTabs.tsx` | activeTerminal, shells, setShell, shellClients | `workspaceUIStore` + `runtimeStore` + `shell.select()` |
| `src/components/TerminalItem.tsx` | activeTerminal, selectTerminal, updateTerminal | `workspaceUIStore` + `workspace.selectTerminal()` + `workspace.updateTerminal()` |
| `src/components/StatusBar.tsx` | activeTerminal, git status | `workspaceUIStore` + terminal from query + `runtimeStore` |
| `src/components/AppKeyboardShortcuts.tsx` | terminals, activeTerminal, selectTerminal, setShell | `workspaceUIStore` + `workspace.selectTerminal()` + `shell.select()` |
| `src/components/CommitDialog.tsx` | activeTerminal | Terminal from query via `workspaceUIStore.activeTerminalId` |
| `src/context/GitHubContext.tsx` | terminals (for branch detection) | `useTerminals()` hook |
| `src/components/TerminalLayout.tsx` | terminal data, shell layout | `useTerminals()` + `workspaceUIStore` |
| `src/components/TerminalModal.tsx` | terminals list for create/edit | `useTerminals()` + `workspace.*` actions |
| `src/components/GitHubModal.tsx` | terminals (branch info) | `useTerminals()` hook |
| `src/components/MobileKeyboardCustomAction.tsx` | active shell/terminal | `workspaceUIStore` + `shell.*` actions |
| `src/components/settings/controls/WebhooksSetting.tsx` | terminals list | `useTerminals()` hook |
| `src/hooks/useNotificationSubscriptions.ts` | terminals data | `useTerminals()` hook |
| `src/components/bottom-panel/tabs/logs/LogsContext.tsx` | terminal data | `useTerminals()` hook |

### New convenience hook

#### `app/src/hooks/useTerminals.ts`

Thin wrapper around the tRPC query + workspaceUIStore:

```ts
export function useTerminals() {
  const { data: terminals = [], isLoading } = trpc.workspace.terminals.listTerminals.useQuery()
  return { terminals, isLoading }
}

export function useActiveTerminal() {
  const activeId = useWorkspaceUIStore((s) => s.activeTerminalId)
  const { terminals } = useTerminals()
  return terminals.find((t) => t.id === activeId) ?? null
}
```

### Events killed in this step: 7

All `shell-*` events (excluding `shell-template-run` which was deleted as orphaned in step 3).

### Providers removed: 1

`WorkspaceProvider`

### Running total events killed: ~47 of 49 (remaining 6 move to typed bus in step 7)

---

## Step 6: githubRuntimeStore

**Risk: Medium** — 8 consumers (incl. context def), cross-context dependency on notifications

### New files

#### `app/src/stores/githubRuntimeStore.ts`

```ts
interface GitHubRuntimeState {
  githubPRs: PRCheckStatus[]
  ghUsername: string | null
  activePR: PRCheckStatus | null
  prPoll: boolean
  mergedPRs: MergedPRSummary[]  // These come from tRPC but are read alongside socket data

  setPRChecks: (data: PRCheckStatus[]) => void
  setActivePR: (pr: PRCheckStatus | null) => void
  setGhUsername: (username: string | null) => void
}
```

#### `app/src/actions/github.ts`

```ts
export const github = {
  mergePR: tracked('github.mergePR', async (owner, repo, prNumber, method) => {
    await api.github.merge.mutate({ owner, repo, prNumber, method })
    toast.success('PR merged')
  }),
  closePR: tracked('github.closePR', async (owner, repo, prNumber) => { ... }),
  requestReview: tracked('github.requestReview', async (...) => { ... }),
  rerunChecks: tracked('github.rerunChecks', async (...) => { ... }),
  rerunAllFailedChecks: tracked('github.rerunAllFailedChecks', async (...) => { ... }),
  addReaction: tracked('github.addReaction', async (...) => {
    // Optimistic update in githubRuntimeStore
  }),
  removeReaction: tracked('github.removeReaction', async (...) => { ... }),
  addComment: tracked('github.addComment', async (...) => { ... }),
  replyToComment: tracked('github.replyToComment', async (...) => { ... }),
  editComment: tracked('github.editComment', async (...) => { ... }),
  createPR: tracked('github.createPR', async (...) => { ... }),
  editPR: tracked('github.editPR', async (...) => { ... }),
  renamePR: tracked('github.renamePR', async (...) => { ... }),
}
```

### Files modified

| File | Change |
|---|---|
| `src/context/GitHubContext.tsx` | **Delete entirely** |
| `src/App.tsx` | Remove `GitHubProvider` |

#### Update 7 consumers

| File | Change |
|---|---|
| `src/components/Sidebar.tsx` | Replace `useGitHubContext()` with `useGitHubRuntimeStore()` + tRPC queries for closedPRs/involvedPRs |
| `src/components/StatusBar.tsx` | Same |
| `src/components/TerminalItem.tsx` | Same |
| `src/components/PRModal.tsx` | Same |
| `src/components/PRStatusContent.tsx` | Replace `useGitHubContext()` + `import * as api` with `useGitHubRuntimeStore()` + `github.*` actions |
| `src/components/command-palette/CommandPalette.tsx` | Same |
| `src/components/bottom-panel/tabs/logs/LogsHeaderActions.tsx` | Same |

### Socket event already handled

`github:pr-checks` was moved to `socketManager.ts` in step 4. The `detect-branches` emit moves into the socket manager or a Zustand subscription on terminal branches.

### `src/lib/api.ts` cleanup

All GitHub functions in `api.ts` are now replaced by `actions/github.ts`. The git branch functions (`getBranches`, `checkoutBranch`, `pullBranch`, etc.) can be moved to `actions/git.ts` at this point or left for step 8.

### Providers removed: 1

`GitHubProvider`

---

## Step 7: Typed event buses for surviving imperative signals

**Risk: Low** — small scope, only ~6 events

### New files

#### `app/src/lib/eventBus.ts`

Inline typed bus (~15 lines) instead of adding `mitt` as a dependency:

```ts
type Handler<T> = (event: T) => void

function createBus<Events extends Record<string, unknown>>() {
  const handlers = new Map<keyof Events, Set<Handler<any>>>()
  return {
    on<K extends keyof Events>(key: K, fn: Handler<Events[K]>) {
      if (!handlers.has(key)) handlers.set(key, new Set())
      handlers.get(key)!.add(fn)
    },
    off<K extends keyof Events>(key: K, fn: Handler<Events[K]>) {
      handlers.get(key)?.delete(fn)
    },
    emit<K extends keyof Events>(key: K, event: Events[K]) {
      handlers.get(key)?.forEach((fn) => fn(event))
    },
  }
}

type TerminalBusEvents = {
  'focus': { terminalId: number }
  'paste': { shellId: number; text: string }
  'claim-primary': { shellId: number }
  'release-primary': { shellId: number }
  'primary-status': { shellId: number; isPrimary: boolean }
}

type UIEffectsBusEvents = {
  'flash-session': { sessionId: string }
}

export const terminalBus = createBus<TerminalBusEvents>()
export const uiEffectsBus = createBus<UIEffectsBusEvents>()
```

#### `app/src/hooks/useBusEvent.ts`

```ts
export function useTerminalBusEvent<K extends keyof TerminalBusEvents>(
  event: K,
  handler: (payload: TerminalBusEvents[K]) => void
) {
  useEffect(() => {
    terminalBus.on(event, handler)
    return () => terminalBus.off(event, handler)
  }, [event, handler])
}
```

### Files modified

| File | Change |
|---|---|
| `src/components/Terminal.tsx` | Replace `addEventListener('terminal-focus')` with `useTerminalBusEvent('focus')`. Same for `terminal-paste`, `claim-primary`, `release-primary` |
| `src/components/ShellTabs.tsx` | Replace `dispatchEvent('claim-primary')` with `terminalBus.emit('claim-primary')`. Same for `release-primary`, `primary-status` |
| `src/components/SessionItem.tsx` | Replace `addEventListener('flash-session')` with `useUIEffectsBusEvent('flash-session')` |
| `src/components/Sidebar.tsx` | Replace `dispatchEvent('flash-session')` with `uiEffectsBus.emit('flash-session')` |

### No new dependencies

Typed bus is inlined (~15 lines). No `mitt` install needed.

### Events killed: remaining 6 DOM events replaced with typed bus (+ 2 orphans deleted in step 3)

### Running total: all 49 DOM events eliminated

---

## Step 8: Session, notification, and final cleanup

**Risk: Low** — lightest touch, mostly extracting actions

### Action files

#### `app/src/actions/sessions.ts`

```ts
export const sessions = {
  select: (id: string) => { /* set active session in a small sessionUIStore or uiStore */ },
  clear: () => { /* clear active session */ },
  update: tracked('sessions.update', async (id, updates) => {
    await api.sessions.update.mutate({ id, ...updates })
    queryClient.setQueryData(['sessions', 'list'], (prev) => /* patch */)
    toast.success('Session updated')
  }),
  delete: tracked('sessions.delete', async (id) => { ... }),
  bulkDelete: tracked('sessions.bulkDelete', async (ids) => { ... }),
}
```

#### `app/src/actions/notifications.ts`

```ts
export const notifications = {
  markRead: tracked('notifications.markRead', async (id) => { ... }),
  markUnread: tracked('notifications.markUnread', async (id) => { ... }),
  markAllRead: tracked('notifications.markAllRead', async () => { ... }),
  markPRRead: tracked('notifications.markPRRead', async (repo, prNumber) => { ... }),
  delete: tracked('notifications.delete', async (id) => { ... }),
  deleteAll: tracked('notifications.deleteAll', async () => { ... }),
}
```

#### `app/src/actions/git.ts`

Move remaining git operations from `api.ts`:

```ts
export const git = {
  checkoutBranch: tracked('git.checkoutBranch', async (...) => { ... }),
  pullBranch: tracked('git.pullBranch', async (...) => { ... }),
  pushBranch: tracked('git.pushBranch', async (...) => { ... }),
  createBranch: tracked('git.createBranch', async (...) => { ... }),
  deleteBranch: tracked('git.deleteBranch', async (...) => { ... }),
  renameBranch: tracked('git.renameBranch', async (...) => { ... }),
  rebaseBranch: tracked('git.rebaseBranch', async (...) => { ... }),
  fetchAll: tracked('git.fetchAll', async (...) => { ... }),
  commit: tracked('git.commit', async (...) => { ... }),
  discard: tracked('git.discard', async (...) => { ... }),
  getHeadMessage: tracked('git.getHeadMessage', async (...) => { ... }),
  checkBranchConflicts: tracked('git.checkBranchConflicts', async (...) => { ... }),
  getBranchCommits: tracked('git.getBranchCommits', async (...) => { ... }),
  getChangedFiles: tracked('git.getChangedFiles', async (...) => { ... }),
}
```

#### `app/src/actions/settings.ts`

```ts
export const settings = {
  update: tracked('settings.update', async (updates) => {
    await api.settings.update.mutate(updates)
    queryClient.invalidateQueries({ queryKey: ['settings'] })
  }),
}
```

#### `app/src/actions/webhooks.ts`

```ts
export const webhooks = {
  create: tracked('webhooks.create', async (config) => { ... }),
  delete: tracked('webhooks.delete', async (id) => { ... }),
  recreate: tracked('webhooks.recreate', async (id) => { ... }),
  test: tracked('webhooks.test', async (id) => { ... }),
}
```

### Files to delete

| File | Replaced by |
|---|---|
| `src/context/SessionContext.tsx` | `actions/sessions.ts` + small slice in `uiStore` or standalone `sessionUIStore` for activeSessionId |
| `src/context/NotificationDataContext.tsx` | `actions/notifications.ts` + tRPC queries directly in components |
| `src/context/NotificationContext.tsx` | **Delete entirely** — logic already extracted to `services/notifications.ts` in step 3.5. Delete NotificationDataContext first (it imports useNotifications), then delete this |
| `src/context/DocumentPipContext.tsx` | **Keep as-is.** It holds imperative browser handles (live `Window`, `MutationObserver`, `HTMLDivElement` containers, style syncing). Only 2 consumers, zero cross-context deps. Not worth converting — it's a self-contained service, not app state |
| `src/hooks/useShellActions.ts` | `actions/shell.ts` (deleted in step 5) |
| `src/hooks/useActiveShells.ts` | `workspaceUIStore` (deleted in step 5) |
| `src/lib/api.ts` | All functions moved to domain action modules |

### Files modified

#### Update SessionContext consumers (16 files)

Replace `useSessionContext()` with:
- `uiStore` (or `sessionUIStore`) for `activeSessionId`
- `trpc.sessions.list.useQuery()` for session list
- `sessions.*` actions for mutations

| File | Change |
|---|---|
| `src/components/AppKeyboardShortcuts.tsx` | Read active session from store, call `sessions.select()` |
| `src/components/Sidebar.tsx` | Read sessions from tRPC query, call `sessions.select()` |
| `src/components/SessionChat.tsx` | Read active session from store |
| `src/components/SessionItem.tsx` | Call `sessions.update()`, `sessions.delete()` |
| `src/components/SessionGroup.tsx` | Read sessions from tRPC query |
| `src/components/SessionSearchPanel.tsx` | Read sessions from tRPC query |
| `src/components/BackfillModal.tsx` | Read sessions from tRPC query |
| `src/components/MobileLayout.tsx` | Read active session from store |
| `src/components/PinnedSessionsPip.tsx` | Read sessions from store/query |
| `src/components/ShellTabs.tsx` | Read active session from store |
| `src/components/TerminalItem.tsx` | Read session info from query |
| `src/components/command-palette/CommandPalette.tsx` | Read sessions from query, call actions |
| `src/components/AppModals.tsx` | Read sessions from query |
| `src/App.tsx` | Remove `useSessionContext()`, read from store/query |
| `src/hooks/useShellActions.ts` | Already deleted in step 5 |

#### Update NotificationDataContext consumers (3 files)

| File | Change |
|---|---|
| `src/components/NotificationList.tsx` | Use tRPC queries directly + `notifications.*` actions |
| `src/components/PRStatusContent.tsx` | Same |
| `src/components/Sidebar.tsx` | Same |

#### Update NotificationContext consumers (6 files)

| File | Change |
|---|---|
| `src/components/settings/controls/PushNotificationSetting.tsx` | Import notification service directly |
| `src/components/settings/controls/WebhooksSetting.tsx` | Import notification service directly |
| `src/hooks/useNotificationSubscriptions.ts` | Import notification service directly |
| `src/context/ProcessContext.tsx` | Already deleted in step 4 — bell logic moved to socketManager which imports notification service directly |
| `src/context/NotificationDataContext.tsx` | Already deleted above in this step |
| `src/main.tsx` | Remove `NotificationProvider` wrapper |

### Update App.tsx provider tree

**Before (9 providers):**
```tsx
DocumentPipProvider > WorkspaceProvider > BottomPanelProvider > ProcessProvider >
  GitHubProvider > NotificationDataProvider > SessionProvider > UIStateProvider > AppContent
```

**After (1 context provider — PiP only):**
```tsx
<trpc.Provider client={trpcClient} queryClient={queryClient}>
  <QueryClientProvider client={queryClient}>
    <DocumentPipProvider>
      <AppContent />
    </DocumentPipProvider>
  </QueryClientProvider>
</trpc.Provider>
```

All app state lives in Zustand stores (module-level singletons). Socket manager initialized once. Actions callable from anywhere. `DocumentPipProvider` survives because it's an imperative browser service (holds live `Window` / `MutationObserver` refs), not app state.

### Providers removed: 3

`SessionProvider`, `NotificationDataProvider`, `NotificationProvider`

### Final cleanup

- Delete `src/lib/api.ts` (all functions moved to action modules)
- Delete empty `src/context/` directory
- Run `npm run lint:fix && npm run check`
- Verify all tRPC queries still work
- Verify all socket events still update UI
- Verify all actions show loading state via `useActionPending()`
- Verify keyboard shortcuts still work
- Verify mobile layout still works

---

## Summary

### New file structure

```
app/src/
├── stores/
│   ├── actionStore.ts          (step 1)
│   ├── tracked.ts              (step 1)
│   ├── hooks.ts                (step 1)
│   ├── uiStore.ts              (step 2)
│   ├── runtimeStore.ts         (step 4)
│   ├── workspaceUIStore.ts     (step 5)
│   └── githubRuntimeStore.ts   (step 6)
├── actions/
│   ├── index.ts                (step 1)
│   ├── workspace.ts            (step 1, extended step 5)
│   ├── process.ts              (step 4)
│   ├── shell.ts                (step 5)
│   ├── github.ts               (step 6)
│   ├── sessions.ts             (step 8)
│   ├── notifications.ts        (step 8)
│   ├── git.ts                  (step 8)
│   ├── settings.ts             (step 8)
│   └── webhooks.ts             (step 8)
├── services/
│   ├── socketManager.ts        (step 4)
│   └── notifications.ts        (step 3.5)
├── lib/
│   ├── eventBus.ts             (step 7)
│   ├── queryClient.ts          (step 4)
│   ├── trpc.ts                 (unchanged)
│   └── ...                     (other utils unchanged)
├── hooks/
│   ├── useBusEvent.ts          (step 7)
│   ├── useTerminals.ts         (step 5)
│   ├── useSocket.ts            (kept — used by socketManager + useTerminalSocket)
│   ├── useTerminalSocket.ts    (kept — per-shell PTY)
│   ├── useKeyboardShortcuts.tsx (modified steps 2-3)
│   └── ...                     (other hooks kept)
├── context/                    (deleted after step 8)
└── components/                 (modified throughout, no structural changes)
```

### Files deleted (11) + 1 kept

| File | Deleted in |
|---|---|
| `src/context/UIStateContext.tsx` | Step 2 |
| `src/context/BottomPanelContext.tsx` | Step 2 |
| `src/context/ProcessContext.tsx` | Step 4 |
| `src/context/WorkspaceContext.tsx` | Step 5 |
| `src/context/GitHubContext.tsx` | Step 6 |
| `src/context/SessionContext.tsx` | Step 8 |
| `src/context/NotificationDataContext.tsx` | Step 8 |
| `src/context/NotificationContext.tsx` | Step 8 |
| `src/context/DocumentPipContext.tsx` | **Kept** (imperative browser service, 2 consumers, no deps) |
| `src/hooks/useShellActions.ts` | Step 5 |
| `src/hooks/useActiveShells.ts` | Step 5 |
| `src/lib/api.ts` | Step 8 |

### New dependencies

| Package | Size | Step |
|---|---|---|
| `zustand` | ~1KB | Step 1 |

### Metrics

| Metric | Before | After |
|---|---|---|
| Context providers | 9 (nested) | 1 (DocumentPipProvider — imperative browser service) |
| DOM custom events | 49 types, 114+ dispatches, 80+ listeners | 6 types on 2 typed inline buses |
| Mutation patterns | 3 inconsistent | 1 (tracked actions) |
| Global loading state access | None | `useActionPending()`, `useActionPendingDomain()`, `useAnyActionPending()` |
| Socket subscription locations | 8 files, 28 subscriptions | 1 file (socketManager) + 5 component-scoped |
