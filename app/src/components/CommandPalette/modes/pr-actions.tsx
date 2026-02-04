import {
  CornerDownLeft,
  ExternalLink,
  Eye,
  GitMerge,
  RefreshCw,
} from 'lucide-react'
import { getPRStatusInfo } from '@/lib/pr-status'
import type { AppActions, AppData, ModeState } from '../createPaletteModes'
import type { PaletteAPI, PaletteItem, PaletteMode } from '../types'

export function createPRActionsMode(
  _data: AppData,
  state: ModeState,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { selectedPR, prLoadingStates } = state

  if (!selectedPR) {
    return {
      id: 'pr-actions',
      breadcrumbs: [],
      placeholder: 'Filter actions...',
      items: [],
    }
  }

  const statusInfo = getPRStatusInfo(selectedPR)
  const isOpen = selectedPR.state === 'OPEN'
  const isMerged = 'isMerged' in statusInfo && statusInfo.isMerged
  const hasFailedChecks =
    'hasFailedChecks' in statusInfo && statusInfo.hasFailedChecks
  const hasConflicts = 'hasConflicts' in statusInfo && statusInfo.hasConflicts
  const hasChangesRequested =
    'hasChangesRequested' in statusInfo && statusInfo.hasChangesRequested

  // Count failed checks for display (need the actual count for label)
  const failedChecksCount = selectedPR.checks.filter(
    (c) =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== 'NEUTRAL',
  ).length

  // Check if PR can be merged
  const canMerge =
    isOpen &&
    selectedPR.mergeable === 'MERGEABLE' &&
    (selectedPR.reviewDecision === 'APPROVED' ||
      selectedPR.reviewDecision === '')

  const isLoading = prLoadingStates?.merging || prLoadingStates?.rerunningAll

  const items: PaletteItem[] = []

  // Reveal (for non-merged PRs - shows PR in sidebar)
  if (!isMerged) {
    items.push({
      id: 'action:reveal',
      label: 'Reveal',
      icon: <Eye className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => actions.revealPR(selectedPR),
    })
  }

  // Open in new tab (all PRs)
  items.push({
    id: 'action:open-url',
    label: 'Open in new tab',
    icon: <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />,
    onSelect: () => {
      window.open(selectedPR.prUrl, '_blank')
      api.close()
    },
  })

  // Rerun all failed checks (if there are any)
  if (hasFailedChecks && isOpen) {
    items.push({
      id: 'action:rerun-all',
      label: `Re-run ${failedChecksCount} failed check${failedChecksCount > 1 ? 's' : ''}`,
      icon: <RefreshCw className="h-4 w-4 shrink-0 text-zinc-400" />,
      disabled: isLoading,
      loading: prLoadingStates?.rerunningAll,
      onSelect: () => {
        if (!isLoading) {
          actions.openRerunAllModal(selectedPR)
        }
      },
    })
  }

  // Merge PR (for open PRs that can be merged)
  if (isOpen) {
    items.push({
      id: 'action:merge',
      label: 'Merge PR',
      icon: <GitMerge className="h-4 w-4 shrink-0 text-purple-400" />,
      disabled: !canMerge || isLoading,
      disabledReason: !canMerge
        ? hasConflicts
          ? 'has conflicts'
          : hasChangesRequested
            ? 'changes requested'
            : selectedPR.reviewDecision === 'REVIEW_REQUIRED'
              ? 'review required'
              : undefined
        : undefined,
      loading: prLoadingStates?.merging,
      onSelect: () => {
        if (canMerge && !isLoading) {
          actions.openMergeModal(selectedPR)
        }
      },
    })
  }

  return {
    id: 'pr-actions',
    breadcrumbs: [selectedPR.prTitle],
    placeholder: 'Filter actions...',
    items,
    onBack: () => ({
      modeId: 'search',
      highlightedId: `pr:${selectedPR.prNumber}:${selectedPR.repo}`,
    }),
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
