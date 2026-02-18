# Changelog

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
