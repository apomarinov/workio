import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  GitBranch,
  GitMerge,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import { PRStatusContent } from './PRStatusContent'
import { TruncatedPath } from './TruncatedPath'

interface PRStatusGroupProps {
  pr: PRCheckStatus
  expanded: boolean
  onToggle: () => void
}

export function PRStatusGroup({ pr, expanded, onToggle }: PRStatusGroupProps) {
  const isMerged = pr.state === 'MERGED'
  const hasRunningChecks = pr.checks.some(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED',
  )
  const hasFailedChecks = pr.checks.some(
    (c) =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== 'NEUTRAL',
  )
  const isApproved = pr.reviewDecision === 'APPROVED'
  const hasChangesRequested = pr.reviewDecision === 'CHANGES_REQUESTED'

  const colorClass = isMerged
    ? 'text-purple-400/70'
    : hasChangesRequested
      ? 'text-orange-400/70'
      : hasRunningChecks
        ? 'text-yellow-500/70'
        : isApproved
          ? 'text-green-500/70'
          : hasFailedChecks
            ? 'text-red-500/70'
            : 'text-zinc-400/70'

  return (
    <div>
      <div
        onClick={isMerged ? undefined : onToggle}
        className={cn(
          'group/pr flex items-center gap-2 pr-3 pl-2 py-2 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0',
          !isMerged && 'cursor-pointer',
        )}
      >
        {isMerged ? (
          <GitMerge className="w-4 h-4 flex-shrink-0 text-purple-400" />
        ) : expanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        ) : (
          <>
            {(hasChangesRequested ||
              hasRunningChecks ||
              isApproved ||
              hasFailedChecks) && (
                <ChevronRight className="w-4 h-4 flex-shrink-0 hidden group-hover/pr:block" />
              )}
            {hasChangesRequested ? (
              <RefreshCw className="w-4 h-4 flex-shrink-0 text-orange-400/70 group-hover/pr:hidden" />
            ) : hasRunningChecks ? (
              <Loader2 className="w-4 h-4 flex-shrink-0 text-yellow-500/70 animate-spin group-hover/pr:hidden" />
            ) : isApproved ? (
              <Check className="w-4 h-4 flex-shrink-0 text-green-500/70 group-hover/pr:hidden" />
            ) : hasFailedChecks ? (
              <CircleX className="w-4 h-4 flex-shrink-0 text-red-500/70 group-hover/pr:hidden" />
            ) : (
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
            )}
          </>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch className={cn('w-4 h-4 flex-shrink-0', colorClass)} />
            <TruncatedPath className="text-xs font-medium" path={pr.branch} />
          </div>
        </div>
        <a
          href={pr.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-muted-foreground flex-shrink-0 hover:text-foreground transition-colors"
        >
          #{pr.prNumber}
        </a>
      </div>
      {!isMerged && expanded && (
        <div className="ml-4 mt-1">
          <PRStatusContent pr={pr} />
        </div>
      )}
    </div>
  )
}
