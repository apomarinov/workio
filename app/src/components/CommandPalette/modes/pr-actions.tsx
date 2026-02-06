import {
  CircleX,
  CornerDownLeft,
  ExternalLink,
  EyeOff,
  GitBranch,
  GitMerge,
  ScrollText,
} from 'lucide-react'
import { RefreshIcon } from '@/components/icons'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

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
    (pr.isApproved || pr.reviewDecision === '')

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
      label: 'Merge',
      icon: <GitMerge className="h-4 w-4 shrink-0 text-purple-400" />,
      disabled: !canMerge,
      disabledReason: !canMerge
        ? hasConflicts
          ? 'has conflicts'
          : hasChangesRequested
            ? 'changes requested'
            : pr.reviewDecision === 'REVIEW_REQUIRED'
              ? 'review required'
              : undefined
        : undefined,
      onSelect: () => {
        if (canMerge) {
          actions.openMergeModal(pr)
        }
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
      <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
            <CornerDownLeft className="h-3 w-3" />
          </kbd>
          to select
        </span>
      </div>
    ),
  }
}
