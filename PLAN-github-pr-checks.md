# Plan: GitHub PR Status in Terminal Item

## Summary

Two features sharing the same data and UI:

1. **Terminal item**: Collapsible "GitHub" section (above Processes) when the terminal's branch has an open PR. Shows review status, failed checks, and latest comments.
2. **Sidebar section**: "GitHub" section (like "Other Claude Sessions") at the bottom of the sidebar. Lists all branches that have PRs, each expandable to show the same review/checks/comments UI.

Both are collapsible with localStorage persistence and controlled by global expand/collapse.

Server polls `gh pr list` per repo (terminal repos only), emits via Socket.IO. Uses `gh` CLI — no npm packages or tokens needed.

---

## Shared Types — `app/shared/types.ts`

Add after existing `ProcessesPayload`:

```typescript
export interface FailedPRCheck {
  name: string
  status: string
  conclusion: string
  detailsUrl: string
}

export interface PRComment {
  author: string
  avatarUrl: string
  body: string
  createdAt: string
}

export interface PRCheckStatus {
  prNumber: number
  prTitle: string
  prUrl: string
  branch: string
  repo: string
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  reviews: { author: string; avatarUrl: string; state: string }[]  // who approved / requested changes
  checks: FailedPRCheck[]
  comments: PRComment[]  // latest 5 non-bot comments, newest first
}

export interface PRChecksPayload {
  prs: PRCheckStatus[]
} 
```

---

## Server Module — `app/server/github/checks.ts` (new file)

### Key functions:

1. **`checkGhAvailable()`** — run `gh --version` once, cache result. If false, entire module is no-op.

2. **`detectGitHubRepo(cwd)`** — run `git remote get-url origin`, parse owner/repo from SSH or HTTPS URL. Cache per cwd.

3. **`fetchPRChecks(owner, repo, branches)`** — run:
   ```
   gh pr list --repo owner/repo --state open --json number,title,headRefName,url,statusCheckRollup,reviewDecision,reviews,comments
   ```
   Parse JSON output. Filter to only PRs whose `headRefName` matches a tracked terminal branch. For each matching PR:
   - Filter `statusCheckRollup` to non-success checks
   - Extract `reviewDecision` and `reviews` (author + state for APPROVED / CHANGES_REQUESTED)
   - Extract latest 5 comments (newest first), filtering out bots (author login contains `[bot]`), include `author.avatarUrl`
   - Include the PR if it has any data to show (failed checks, review decision, or comments)

4. **`pollAllPRChecks()`** — collect unique repos from tracked terminals, gather active branches, call `fetchPRChecks` per repo, emit `github:pr-checks` Socket.IO event. Called every 60s.

5. **Lifecycle**: `trackTerminal(terminalId)` / `untrackTerminal(terminalId)` — start/stop polling.

### Caching:
- Repo cache: `cwd → {owner, repo}` — server lifetime
- Check results cache: `owner/repo → {prs, fetchedAt}` — 30s TTL
- Graceful errors: API failures return last cached data

---

## Server Integration — `app/server/pty/manager.ts`

- Import `trackTerminal`, `untrackTerminal`, `refreshPRChecks`, `startChecksPolling`
- In `detectGitBranch()`: after updating branch, call `refreshPRChecks()`
- In `createSession()`: call `trackTerminal(terminalId)` + `startChecksPolling()`
- In `destroySession()`: call `untrackTerminal(terminalId)`

---

## Frontend Hook — `app/src/hooks/useGitHubChecks.ts` (new file)

```typescript
export function useGitHubChecks(): PRCheckStatus[]
```

Subscribes to `github:pr-checks` Socket.IO event. Full replace on each update.

---

## Terminal Item — `app/src/components/TerminalItem.tsx`

### New "GitHub" collapsible section (above Processes)

- Same toggle pattern as Processes section
- **Collapsible**, state stored in localStorage (`sidebar-collapsed-terminal-github`)
- Controlled by global expand/collapse all button in `Sidebar.tsx`
  - Wire through props like `processesExpanded` / `onToggleProcesses`
  - Add `githubExpanded` / `onToggleGitHub` props
  - Add localStorage key `sidebar-collapsed-terminal-github` in Sidebar
  - Include in `expandAll()` / `collapseAll()` / `allExpanded`

### Section content:

**1. Reviews** (one line per reviewer who approved or requested changes)
- Approved: green `Check` icon + avatar (16px rounded) + reviewer name — clickable, opens PR URL
- Changes requested: `RefreshCw` icon (red/orange) + avatar + reviewer name — clickable, opens PR URL
- Each review is its own line, derived from `reviews` array filtered to `APPROVED` / `CHANGES_REQUESTED` states

**2. Failed checks** (if any)
- Each check: red `CircleX` (failed) or spinning `Loader2` (in-progress) + check name
- Clickable `<a>` to `check.detailsUrl`

**3. Latest 5 comments** (newest first)
Each comment is a mini expandable item (local state only, no localStorage):
- **Collapsed (default)**:
  - Line 1: chevron (right) + user avatar (16px `<img>` rounded, from `avatarUrl`) + author name
  - Line 2: first line of comment body, truncated with `truncate` class
- **Expanded**:
  - Line 1: chevron (down) + avatar + author name
  - Full comment body rendered with existing `MarkdownContent` component (`app/src/components/MarkdownContent.tsx`)
  - Clicking the expanded comment body opens a **Dialog** (shadcn) modal with the full comment content rendered as markdown

### Visibility conditions
- The chevron on the terminal item and the expanded section should also consider `hasGitHub` (PR exists for this branch)
- `hasGitHub` = PR found where `pr.branch === terminal.git_branch`

---

## Sidebar.tsx changes

### Terminal item GitHub section (props passthrough)
- Add `collapsedTerminalGitHub` / `setCollapsedTerminalGitHub` localStorage state
- Add `toggleTerminalGitHub(terminalId)` function
- Pass `githubExpanded` / `onToggleGitHub` props through to TerminalItem (via SortableTerminalItem / FolderGroup)
- Wire into `expandAll()` / `collapseAll()` / `allExpanded`

### "GitHub" sidebar section (new, like "Other Claude Sessions")

Add after "Other Claude Sessions" at the bottom of the sidebar scroll area:
- Divider + "GitHub" uppercase label with chevron for collapse
- Collapsible, state stored in localStorage (`sidebar-section-github-collapsed`)
- Controlled by global expand/collapse all button
- Wire into `expandAll()` / `collapseAll()` / `allExpanded`
- Import `useGitHubChecks` hook to get all PRs
- List each PR as a collapsible group using new `PRStatusGroup` component

---

## New Component: `app/src/components/PRStatusGroup.tsx`

A collapsible group for one PR branch, used in the sidebar "GitHub" section. Follows `SessionGroup` pattern:
- Header: chevron + git branch icon + branch name + PR number badge
- Expanded: reuses the same UI as the terminal item GitHub section content:
  - Review status (approved / changes requested, clickable to PR URL)
  - Failed checks (icons + names, clickable to details)
  - Latest 5 non-bot comments (expandable items with avatar, markdown, modal)

Extract the shared review/checks/comments rendering into a `PRStatusContent` component so both `TerminalItem` and `PRStatusGroup` can reuse it.

---

## New Component: `app/src/components/PRStatusContent.tsx`

Shared component rendering the inner content of a PR status display. Used by both `TerminalItem` (GitHub section) and `PRStatusGroup` (sidebar section). Takes a `PRCheckStatus` as prop and renders:
1. Review status line (if set)
2. Failed checks list (if any)
3. Comments list with expand/collapse + modal

---

## Files Summary

| File | Action |
|------|--------|
| `app/shared/types.ts` | Add `FailedPRCheck`, `PRComment`, `PRCheckStatus`, `PRChecksPayload` |
| `app/server/github/checks.ts` | **New** — server polling, `gh` CLI integration |
| `app/server/pty/manager.ts` | Wire checks lifecycle into session create/destroy/branch detection |
| `app/src/hooks/useGitHubChecks.ts` | **New** — Socket.IO subscription hook |
| `app/src/components/PRStatusContent.tsx` | **New** — shared review/checks/comments UI used by both terminal item and sidebar |
| `app/src/components/PRStatusGroup.tsx` | **New** — collapsible branch group for sidebar GitHub section |
| `app/src/components/TerminalItem.tsx` | Add collapsible GitHub section using `PRStatusContent` |
| `app/src/components/Sidebar.tsx` | Add GitHub sidebar section + localStorage state + props for terminal GitHub collapse, wire into global toggle |
| `app/src/components/SortableTerminalItem.tsx` | Pass through `githubExpanded` / `onToggleGitHub` props |
| `app/src/components/FolderGroup.tsx` | Pass through `githubExpanded` / `onToggleGitHub` props |

## Verification

- `npm run lint:fix && npm run check`
- Test with a repo that has a branch with a failing PR check
- Verify GitHub section appears with review status, checks, and comments
- Verify comment expand/collapse and modal work
- Verify section collapse persists in localStorage
- Verify global expand/collapse controls the GitHub section
- Verify sidebar GitHub section shows all PR branches with same UI
- Verify no errors when `gh` is not installed
