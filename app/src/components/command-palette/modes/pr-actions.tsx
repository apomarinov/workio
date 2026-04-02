import {
  AlertTriangle,
  CircleX,
  CornerDownLeft,
  ExternalLink,
  EyeOff,
  FileDiff,
  GitBranch,
  GitMerge,
  Pencil,
  Play,
  ScrollText,
} from 'lucide-react'
import type {
  AppActions,
  AppData,
} from '@/components/command-palette/createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '@/components/command-palette/types'
import { ClaudeIcon, RefreshIcon } from '@/components/icons'

export function createPRActionsMode(
  data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { pr, terminal } = level
  const { terminals } = data

  if (!pr) {
    return {
      id: 'pr-actions',
      placeholder: 'Filter actions...',
      items: [],
    }
  }

  const isOpen = pr.state === 'OPEN'

  // Use pre-computed flags from server
  const {
    hasFailedChecks,
    hasConflicts,
    hasChangesRequested,
    failedChecksCount,
  } = pr

  // Check if PR can be merged
  const canMerge =
    isOpen &&
    pr.mergeable === 'MERGEABLE' &&
    (pr.isApproved ||
      pr.reviewDecision === '' ||
      pr.reviewDecision === 'REVIEW_REQUIRED')
  const needsReview = pr.reviewDecision === 'REVIEW_REQUIRED'

  const items: PaletteItem[] = []

  // Open in new tab (all PRs)
  items.push({
    id: 'action:open-url',
    label: 'View on GitHub',
    icon: <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />,
    onSelect: () => {
      window.open(pr.prUrl, '_blank')
      api.close()
    },
  })

  // View Changes (only for open PRs with a base branch and a matching terminal)
  // Prefer non-SSH terminals so we can diff locally
  const repoTerminals = terminals.filter((t) => t.git_repo?.repo === pr.repo)
  const matchingTerminal =
    terminal ?? repoTerminals.find((t) => !t.ssh_host) ?? repoTerminals[0]
  if (isOpen && pr.baseBranch && matchingTerminal) {
    items.push({
      id: 'action:view-changes',
      label: 'View Changes',
      icon: <FileDiff className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        actions.openDiffViewer(pr, matchingTerminal.id)
      },
    })
  }

  // Resume snapshot (only if a terminal has a saved snapshot for this branch)
  const snapshotTerminal = terminals.find(
    (t) => t.settings?.snapshots?.[pr.branch],
  )
  if (snapshotTerminal) {
    items.push({
      id: 'action:resume',
      label: 'Resume',
      icon: <Play className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        actions.resumeSnapshot(snapshotTerminal.id, pr.branch)
      },
    })
  }

  // Checkout (only if no terminal is selected in the stack)
  // Check if there are any terminals from the same repo
  const hasMatchingTerminals =
    !terminal && terminals.some((t) => t.git_repo?.repo === pr.repo)
  if (hasMatchingTerminals && isOpen) {
    items.push({
      id: 'action:checkout',
      label: 'Checkout',
      icon: <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        api.push({
          mode: 'pr-checkout',
          title: 'Checkout',
          pr,
        })
      },
      onNavigate: () => {
        api.push({
          mode: 'pr-checkout',
          title: 'Checkout',
          pr,
        })
      },
    })
  }

  // Rerun all failed checks (if there are any)
  if (hasFailedChecks && isOpen) {
    items.push({
      id: 'action:rerun-all',
      label: `Re-run ${failedChecksCount} failed check${failedChecksCount > 1 ? 's' : ''}`,
      icon: <RefreshIcon className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        actions.openRerunAllModal(pr)
      },
    })
  }

  // Merge PR (for open PRs that can be merged)
  if (isOpen) {
    items.push({
      id: 'action:merge',
      label: needsReview ? (
        <span className="flex items-center gap-1.5 w-full">
          Merge
          <span className="flex items-center gap-1 ml-auto text-xs text-yellow-400/70">
            <AlertTriangle className="h-3 w-3" />
            Not approved yet
          </span>
        </span>
      ) : (
        'Merge'
      ),
      icon: <GitMerge className="h-4 w-4 shrink-0 text-purple-400" />,
      disabled: !canMerge,
      disabledReason: !canMerge
        ? hasConflicts
          ? 'has conflicts'
          : hasChangesRequested
            ? 'changes requested'
            : undefined
        : undefined,
      onSelect: () => {
        if (canMerge) {
          actions.openMergeModal(pr)
        }
      },
    })
  }

  // Edit PR (only for open PRs)
  if (isOpen) {
    items.push({
      id: 'action:edit',
      label: 'Edit',
      icon: <Pencil className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        actions.openEditPRModal(pr)
      },
    })
  }

  // Close PR (only for open, unmerged PRs)
  if (isOpen) {
    items.push({
      id: 'action:close',
      label: 'Close',
      icon: <CircleX className="h-4 w-4 shrink-0 text-red-400" />,
      onSelect: () => {
        actions.openCloseModal(pr)
      },
    })
  }

  // Hide PR
  items.push({
    id: 'action:hide',
    label: 'Hide',
    icon: <EyeOff className="h-4 w-4 shrink-0 text-zinc-400" />,
    onSelect: () => {
      actions.hidePR(pr)
    },
  })

  // Claude Sessions
  const sessionCount = data.sessions.filter(
    (s) =>
      (s.data?.branch === pr.branch && s.data?.repo === pr.repo) ||
      s.data?.branches?.some(
        (e) => e.branch === pr.branch && e.repo === pr.repo,
      ),
  ).length
  if (sessionCount > 0) {
    items.push({
      id: 'action:claude-sessions',
      label: `Claude Sessions (${sessionCount})`,
      icon: <ClaudeIcon className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        api.close()
        window.dispatchEvent(
          new CustomEvent('open-session-search', {
            detail: { repo: pr.repo, branch: pr.branch },
          }),
        )
      },
    })
  }

  // View Logs
  const prName = `${pr.repo}#${pr.prNumber}`
  items.push({
    id: 'action:logs',
    label: 'Logs',
    icon: <ScrollText className="h-4 w-4 shrink-0 text-zinc-400" />,
    onSelect: () => {
      window.dispatchEvent(new CustomEvent('open-logs', { detail: { prName } }))
      api.close()
    },
  })

  return {
    id: 'pr-actions',
    placeholder: 'Filter actions...',
    items,
    footer: () => (
      <span className="flex items-center gap-1.5 ml-auto">
        <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
          <CornerDownLeft className="h-3 w-3" />
        </kbd>
        to select
      </span>
    ),
  }
}
