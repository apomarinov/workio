# Changelog

## [v0.9.0](../../compare/v0.8.0...v0.9.0) — 2026-03-30

### Features
- Add shell multiplexing with split panes — per-shell layout trees stored in terminal settings
- Add drag-and-drop pane reordering — hold configurable modifier (default: right Alt) to enter drag mode with swap and edge-drop support
- Add split buttons to drag handle — hover the grip to reveal directional split buttons on each edge
- Add split layout support to shell templates — visual layout editor in template modal with PaneLayout preview
- Add left/right modifier side detection for single-modifier keyboard shortcuts
- Add Monaco-based diff editors replacing diff2html in FileDiffViewer and UnifiedDiffViewer
- Add editable diff viewer with file save and collapsible commits panel
- Add shell template management in Settings > Terminal > General
- Add scrollback and SSH max channels settings to settings UI

### Improvements
- Extract generic PaneLayout component for reusable recursive panel rendering
- Wire paneDrag shortcut into keymap system with configurable binding
- Always render shells through TerminalLayout on desktop for consistent split button access
- Move ShellTemplateModal to AppModals with event-based open/close
- Move DirectoryBrowser from CommandPalette to AppModals
- Add favorite folders to file picker with star button and popover
- Consolidate UIState settings, loading toasts, keymap search, close shell shortcut
- Rework palette breadcrumbs layout and unify session search filter
- Unify terminal create/edit into single modal with shell picker dropdown

### Bug Fixes
- Disable Monaco diagnostics and enable JSX compiler options for diff editors
- Fix shell restart on change with confirm modal and bash integration

## [v0.8.0](../../compare/v0.7.0...v0.8.0) — 2026-03-28

### Features
- Add bottom panel with VS Code-style resize, minimize/maximize, and lazy-loaded tab views
- Add real-time log streaming with cursor-based infinite scroll, filters, and delete
- Add comprehensive command logging with deduped upsert support
- Add settings view with registry, sidebar, search, and inline keymap editor
- Add server settings map for runtime-configurable server constants
- Add inline push notification configuration in settings
- Add custom commands section in settings
- Add SSH shell picker — fetches available shells from remote host with login shell detection
- Add author filters and hidden PRs in GitHub settings
- Add alternating row backgrounds with hover in keymap settings

### Improvements
- Refactor settings to dot-path form helpers with validation, dirty tracking, and auto-save
- Lift bottom panel state to context for persistence across terminal switches
- Replace sidebar width prop with container queries for compact mode
- Implement per-tab panel context architecture
- Use `onLayoutChanged` for panel size persistence instead of `onResize`
- Remove old settings modals — all settings now live in the unified settings view
- Centralize shared `execFileAsync` helpers and eliminate duplication
- Auto-focus search on settings open
- Flash on navigate to settings section
- Disable create button while SSH audit or shell loading is in progress

### Bug Fixes
- Fix DB connection leak — rollback idle transactions in monitor daemon
- Fix panel resize handle hover shifting layout
- Fix session sort order on resume and collapse healthy tunnel sub-rows
- Fix breadcrumb padding in settings
- Revert process-tree to plain `execFileAsync` — exit code 1 means empty results, not errors

## [v0.7.0](../../compare/v0.6.0...v0.7.0) — 2026-03-26

### Features
- Add typed `ServerEventMap` for compile-time event safety across all Socket.IO emissions
- Add notification grouping — multiple failed checks are batched into a single notification
- Open branch actions panel when clicking remote sync arrows in status bar
- Add session search panel integration replacing the old branch-claude-sessions palette mode

### Improvements
- Migrate entire backend to tRPC domain architecture — sessions, PTY, git, GitHub, workspace, settings, logs, and notifications each live in their own domain with colocated schema, db, service, and router
- Replace Zod data schemas with plain TypeScript types across all domains, keeping runtime validation only at trust boundaries
- Break all circular dependencies in server (11 → 0) with EventEmitter decoupling and path alias restructuring
- Remove SWR — all data fetching now uses React Query via tRPC
- Delete `shared/types.ts` and `src/types.ts` — all types moved into their owning domains
- Split permission scanner — PTY keeps buffer renderer, sessions owns parsing and storage
- Move workspace initialization out of GitHub polling into workspace domain
- Extract git status logic from PTY monitor into git domain
- Flatten server structure: separate `server/index.ts` by concern into focused modules
- Replace all relative imports with `@domains`/`@server` path aliases
- Extract ngrok into standalone service with settings UI configuration
- Centralize API error handling and JSON serialization in `apiFetch`/`api` helpers
- Extract shared `execFileAsync`, `gitExec`, `shellEscape` helpers to eliminate duplication
- Deduplicate dialog boilerplate, error toasts, and dynamic UPDATE builders
- Extract GitHub and notification routes from `index.ts` into route plugins
- Derive session search repo/branch filters from session data instead of git
- Improve shell template execution and mutation error handling with `toastError`

### Bug Fixes
- Fix untracked file diff display and nullable review body
- Fix PR activity dots not updating by replacing Map/Set with plain objects in SWR cache
- Fix dynamic Tailwind `group-hover` classes not generating CSS
- Fix settings partial update overwriting unrelated fields
- Fix file picker escaping digit 2, refocus terminal on close, and defer session select until expanded
- Fix mutation error handling with try/catch and `toastError` across all mutations

## [v0.6.0](../../compare/v0.5.0...v0.6.0) — 2026-03-15

### Features
- Add remote Claude hook forwarding via SSH reverse tunnels
- Add service status backend and UI indicator with info modals per service row
- Split Claude tunnel status into separate bootstrap and tunnel sub-statuses per host
- Add configurable GitHub GraphQL query limits
- Add Commit keyboard shortcut (Shift+Cmd+K)
- Allow selecting folders in DirectoryBrowser file select mode

### Improvements
- Refactor App.tsx: extract modals, shortcuts, layout, and shell actions into separate modules
- Split TerminalContext into WorkspaceContext, GitHubContext, and NotificationDataContext
- Consolidate session status icons into SessionStatusIcon component
- Centralize mounted shells state and UI polish
- Rename CommandPalette directory to command-palette
- Rename Push Notifications to Mobile Notifications and Webhooks modal to GitHub
- Use stable SSH host identifiers for projects and fix tunnel restart loop
- Improve diff viewer UX: scrollable file names, collapsible sections, mobile commit toggle
- Collapse repo groups on collapse-all, skip groups with active terminal/PR

### Bug Fixes
- Fix shell not mounting on mobile when clicking terminal in sidebar
- Fix webhook status falsely showing missing after sleep/wake
- Fix shell client badges not showing on initial page load
- Fix system memory usage showing inflated values by using OS-level stats
- Refetch notifications on bell popover close

## [v0.5.0](../../compare/v0.4.0...v0.5.0) — 2026-03-13

### Features
- Add SSH connection pool, remote process scanning, and setup rerun support
- Add per-SSH-host system resource collection and display with system-wide overview
- Add SSH reverse port forwarding for remote detected ports
- Enable "Open in IDE" for SSH terminals via `--remote ssh-remote+host`
- Add SSH MaxSessions audit/fix in create terminal modal, allow input during setup/delete
- Add remote SSH port detection via `ss` and remote Zellij process scanning
- Add composite repo+host grouping in sidebar for SSH terminals
- Add "Ignore external sessions" setting to skip non-WorkIO Claude sessions
- Add ResourceInfo component with per-shell CPU/RAM usage bars, process list, and 3-mode toggle
- Add session backfill feature to import untracked JSONL sessions
- Add undo/drop commit actions to branch commits panel
- Add hold-to-repeat for repeatable terminal action buttons
- Add "Run Anyway" option to process running confirm modal
- Add hover tooltips on terminal links showing available actions
- Add retry option to apiFetch for network errors on wake from sleep
- Add interactive edge swipe with element tracking, flick detection, and Tailwind v4 support

### Improvements
- Replace WebLinksAddon with custom URL link provider and OSC 8 handler
- Improve shell tab styling: left-align text, accent chevron, symmetric padding
- Add customizable truncate-fade and improve shell tab overflow behavior
- Improve sidebar SSH repo label layout with inline host indicator
- Unify goToTab shortcut with sidebar terminal ordering
- Extract shared scanWorkers helper to deduplicate process scanning logic
- Add X close button to commit and PR diff bottom sheets
- Refactor sidebar button sizes for consistency
- Select target terminal after successful PR branch checkout
- Adopt existing webhooks on 422, add hours/minutes to formatDate
- Add SSH keepalive, rename backfill button, lint fixes
- Auto-create database in dev mode, add nvm use to dev script
- Update architecture diagram to Mermaid with PTY worker layer

### Bug Fixes
- Fix URL and file path link detection across soft-wrapped terminal lines
- Fix PR diff viewer and branch commits for SSH terminals
- Fix PR icon not showing on terminal items when status bar is enabled
- Fix duplicate shell client icons on reconnect
- Fix edge swipe bugs: block non-edge opens, correct snap-back, remove dead sidebar buttons
- Force git dirty status emit after commit and discard actions
- Revalidate all SWR data on wake from sleep via timer gap detection
- Fix SSH git config user.name failure, reorder status bar

## [v0.4.0](../../compare/v0.3.0...v0.4.0) — 2026-03-09

### Features
- Add Create Pull Request dialog with diff viewer, commit list, and conflict detection
- Add session search side panel with repo, branch, and recency filters
- Add mobile responsive session search and diff/changes modals with unified diff view
- Add branch diff panel with compare and branch commit modes, paginated commit dialog
- Add resizable panels with localStorage persistence to commit and file lists
- Add merge-base separator to branch commit list and draft toggle to Edit PR
- Track all branches a session has been on and show last updated date on session search results
- Add last commit section to status bar and show all processes/ports grouped by shell
- Add per-shell primary client with requestPrimary flag, auto-release, and active shell tracking
- Broadcast refetch events to other clients on mutations for real-time sync
- Add Opt+Click to copy filepath/URL to clipboard in terminal
- Add Cmd+Arrow and Cmd+Backspace terminal shortcuts, show in keymap modal
- Add toggle sidebar shortcut (Opt+`), Pull Branch shortcut (Cmd+T), and Branches shortcut (Ctrl+Shift+Enter)
- Add Cmd+1-9 to select custom commands in palette
- Add edge swipe gesture to open/close mobile sidebar
- Add per-IP auth lockout notification on brute-force detection
- Add single notification delete with trash icon on hover and read/unread toggle
- Add edit button for own PR comments and reviews
- Add custom notification sound for bell subscription notifications
- Add separate mobile font size setting for terminals

### Improvements
- Convert CommitDialog from modal to collapsible bottom sheet
- Replace custom diff viewer with diff2html for smooth scrolling
- Fork each shell PTY into its own child process to prevent event loop starvation
- Only mount recently-active shells to reduce DOM/memory overhead, keep active ones mounted
- Unify CreateTerminalModal, PR modal, and CommitDialog to single instances in App.tsx
- Unify resume-session and custom commands into run-in-shell
- Redesign ActionChip as ActionButton with modern depth styling and tap sound
- Scale-to-fit for non-primary clients instead of PTY resize wars
- Switch ngrok from SDK to CLI for HTTPS upstream compatibility
- Optimize large build chunks by reducing bundle sizes
- Persist terminal and shell DnD order to settings table
- Write shell integration scripts to ~/.workio/ and source from there
- Improve PR modal responsiveness, DirectoryBrowser dialog, and status bar layout
- Block pull shortcut when git is dirty with warning toast
- Show PR base branch in sidebar when targeting non-main branch
- Suppress client-side notifications when device has push subscription
- Move connected clients indicator to sidebar header and mobile bar
- Add structured logging to broadcastRefetch with human-readable client labels
- Enrich permission notifications with actual permission details
- Retry permission prompt scanning with exponential backoff
- Relax git dirty restrictions, add remote rename, and fix status colors
- Append meta message to transcript when moving session to new project
- Replace pixel art mascot icon and deduplicate sessionStatusColor
- Extract useEdgeSwipe hook and fix search highlight to target bubbles

### Bug Fixes
- Fix stale active_cmd clearing racing with process detection across multiple scenarios
- Fix safe area inset handling for mobile slide panels and dialog close button
- Fix review reactions using GraphQL and log non-2xx responses
- Fix unhandled push notification error crashing server
- Fix desktop:active not firing for keyboard input
- Fix active permissions query returning stale data from old prompts
- Fix shell close from tab menu not updating state
- Fix nested button hydration error and limit WebGL contexts to visible shells
- Fix PR draft toggle, push tracking, and ahead/behind sync
- Cache git fetch to deduplicate redundant network calls in PR view
- Clear diff viewer when all files are discarded
- Fix daemon.sock cleanup error on shutdown
- Refocus active shell when any dialog or palette closes
- Match mobile PWA safe-area background to terminal color

## [v0.3.0](../../compare/v0.2.0...v0.3.0) — 2026-03-01

### Features
- Add multi-shell support with shell-grouped processes/ports in sidebar
- Add drag-and-drop shell tab reordering with 2D drag support
- Add shell tab context menu with rename, close, and kill-all actions
- Add keyboard shortcuts for shell navigation (prev/next/goTo) respecting drag order
- Add shell templates with keyboard shortcut (Shift+Option+K)
- Add mobile terminal keyboard with input, custom actions, and customization
- Add responsive mobile layout with sidebar overlay and tab improvements
- Add mobile keyboard features: touch scroll, drag reorder, edit custom actions, direct input mode, long-press text selection, inertia momentum scrolling
- Add Web Push notifications with self-signed HTTPS support
- Add push notifications for bell/command-end events with per-session tag grouping
- Add permission prompt detection, storage, and Ctrl+C cancellation
- Add custom commands palette mode with Opt+A shortcut and mobile button
- Add PR "View Changes" diff viewer to command palette
- Add shift+click range selection and blue highlight in file picker
- Add Edit PR dialog to edit title and description
- Add emoji reactions on PR comments/reviews with optimistic updates
- Add involved PRs (review-requested/mentioned) with notifications
- Add Claude Sessions view to branch actions in command palette
- Add recursive folder grouping in file list panel
- Add real process PIDs, bell subscription notifications, and kill button
- Add process startedAt tracking and show elapsed time in processes tab
- Add shell suspension infrastructure (disabled by default)
- Add multi-client device indicator on shell tabs with popover details
- Add resume-in-new-shell option and resume session in original shell with process kill confirmation
- Add Move Session To Project feature
- Add star branches and unfavorite sessions in palette
- Add unified notification registry as single source of truth

### Improvements
- Refactor keyboard shortcuts to use react-hotkeys-hook with fire-on-detect bindings
- Redesign keyboard shortcuts modal with compact rows and scrollable content
- Replace empty SWR mutate() refetches with optimistic cache updates
- Extract ActionChip component for custom commands palette
- Extract FileListPanel to fix checkbox lag in commit dialog
- Extract shell selection into useActiveShells hook
- Consolidate WebSocket tracking into single wsInfo and shells maps
- Consolidate GitHub rate limit logging into single per-poll API call
- Move bell detection from client xterm to server-side PTY parsing
- Move session cleanup from Python worker to webapp UI
- Broadcast PTY output to all connected clients viewing the same shell
- Enforce one shell connection per device to prevent duplicate tab conflicts
- Parallelize process scanning with Promise.all to reduce poll latency
- Buffer xterm writes for hidden shells, auto-name shells, and select new shells
- Persist active terminal and shell selection across page refresh
- Skip terminal WebSocket connections when PWA is in background
- Use sm:max-w-* on DialogContent for mobile-friendly dialogs
- Switch PR fetching from GitHub search API to REST+GraphQL
- Suppress push notifications when user is active
- Navigate to correct terminal and shell on notification click
- Auto-detect git repo for local folders
- Add MesloLGS NF font and enable network access in dev server

### Bug Fixes
- Fix Socket.IO connection failing on LAN/non-localhost access (Safari, iPhone)
- Fix PWA safe area handling for notch and home indicator
- Fix mobile PWA connection timeout, keyboard customize defaults, and modal overflow
- Fix duplicate push notifications on iOS PWA using dedup_hash as tag
- Fix session name and prompt getting wiped on resume
- Fix duplicate notifications and fill notification gaps
- Fix tab-to-focus to target the active shell's xterm textarea
- Fix user activity detection for terminal keyboard input
- Fix close shell shortcut not showing confirm dialog for active processes
- Fix terminal shortcut numbering to match render order
- Fix error toast red tint not applying
- Fix message ordering on reprocessed sessions and store AskUserQuestion answers

## [v0.2.0](../../compare/v0.1.0...v0.2.0) — 2026-02-18

### Features
- Add discard changes, clickable dirty stats, maximize diff viewer, and fix new file diff
- Add commit dialog shortcuts (Opt+A amend, Opt+N no verify) and Cmd+Enter commit
- Include untracked file line counts in git dirty stats

### Improvements
- Virtualize FileDiffViewer with @tanstack/react-virtual and lazy load CommitDialog
- Improve commit dialog file list overflow, add refresh and tooltips
- Replace localStorage PR seen tracking with DB-backed unread notifications
- Use ConfirmModal instead of raw AlertDialog in CommitDialog and KeymapModal

## v0.1.0 — 2026-02-18

Initial release.
