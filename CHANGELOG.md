# Changelog

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
