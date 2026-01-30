import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock,
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
  hasNewActivity?: boolean
  onSeen?: () => void
}

export function PRStatusGroup({
  pr,
  expanded,
  onToggle,
  hasNewActivity,
  onSeen,
}: PRStatusGroupProps) {
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
  const hasPendingReviews = pr.reviews.filter((r) => r.state === 'PENDING').length > 0;

  return (
    <div>
      <div
        onClick={
          isMerged
            ? undefined
            : () => {
              onToggle()
              onSeen?.()
            }
        }
        className={cn(
          'group/pr flex items-center gap-2 pr-3 pl-2 py-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0',
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
            ) : hasPendingReviews ? <Clock className='w-4 h-4' /> : (
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
            )}
          </>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate block">
            {pr.prTitle}
          </span>
          <div className="flex gap-1 items-center">
            <GitBranch className="w-2.5 h-2.5" />
            <TruncatedPath
              className="text-[11px] text-muted-foreground/70"
              path={pr.branch}
            />
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
        {hasNewActivity && (
          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        )}
      </div>
      {!isMerged && expanded && (
        <div className="ml-4">
          <PRStatusContent
            pr={pr}
            expanded
            onToggle={() => { }}
            hasNewActivity={hasNewActivity}
            onSeen={onSeen}
          />
        </div>
      )}
    </div>
  )
}
