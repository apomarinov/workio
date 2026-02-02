import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
} from 'lucide-react'
import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import { getPRStatusInfo, PRStatusContent, PRTabButton } from './PRStatusContent'
import { TruncatedPath } from './TruncatedPath'

interface PRStatusGroupProps {
  pr: PRCheckStatus
  expanded: boolean
  onToggle: () => void
  hasNewActivity?: boolean
  onSeen?: () => void
}

export const PRStatusGroup = memo(function PRStatusGroup({
  pr,
  expanded,
  onToggle,
  hasNewActivity,
  onSeen,
}: PRStatusGroupProps) {
  const prInfo = getPRStatusInfo(pr)

  return (
    <div data-pr-branch={pr.branch}>
      <div
        onClick={
          prInfo.isMerged
            ? undefined
            : () => {
              onToggle()
              onSeen?.()
            }
        }
        className={cn(
          'group/pr flex items-center gap-2 pr-3 pl-2 py-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0',
          !prInfo.isMerged && 'cursor-pointer',
        )}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        ) : prInfo.hasChangesRequested ||
          prInfo.hasRunningChecks ||
          prInfo.hasFailedChecks ||
          prInfo.isMerged ||
          prInfo.areAllChecksOk ||
          (prInfo.isApproved && prInfo.hasConflicts) ||
          prInfo.isApproved ||
          prInfo.hasPendingReviews ? (
          prInfo.icon({ cls: 'w-4 h-4' })
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
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
          className="text-xs text-muted-foreground hidden group-hover/pr:block flex-shrink-0 hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-4 h-4 cursor-pointer" />
        </a>
        {hasNewActivity && (
          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        )}
      </div>
      {!prInfo.isMerged && expanded && (
        <div className="ml-4">
          <PRTabButton pr={pr} />
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
})
