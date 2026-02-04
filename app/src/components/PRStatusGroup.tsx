import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  MoreVertical,
} from 'lucide-react'
import { memo } from 'react'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import { PRStatusContent, PRTabButton } from './PRStatusContent'

interface PRStatusGroupProps {
  pr: PRCheckStatus
  expanded: boolean
  onToggle: () => void
  hasNewActivity?: boolean
  onSeen?: () => void
  isActive?: boolean
}

export const PRStatusGroup = memo(function PRStatusGroup({
  pr,
  expanded,
  onToggle,
  hasNewActivity,
  onSeen,
  isActive,
}: PRStatusGroupProps) {
  const prInfo = getPRStatusInfo(pr)

  return (
    <div data-pr-branch={pr.branch}>
      <div
        onClick={() => {
          if (!prInfo.isMerged) {
            onToggle()
          }
          onSeen?.()
        }}
        className={cn(
          'group/pr flex items-center gap-2 pr-3 pl-2 py-1.5 transition-colors min-w-0',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
          !prInfo.isMerged && 'cursor-pointer',
        )}
      >
        {expanded && !prInfo.isMerged ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        ) : prInfo.hasChangesRequested ||
          prInfo.hasRunningChecks ||
          prInfo.hasFailedChecks ||
          prInfo.isMerged ||
          prInfo.areAllChecksOk ||
          prInfo.hasConflicts ||
          prInfo.isApproved ||
          prInfo.hasConflicts ||
          prInfo.hasPendingReviews ? (
          prInfo.icon({ cls: 'w-4 h-4' })
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate block">
            {pr.prTitle}
          </span>
          <div className="flex gap-1 items-center justify-between min-w-0">
            <div className="flex gap-1 items-center min-w-0">
              <GitBranch className="min-w-2.5 min-h-2.5 max-w-2.5 max-h-2.5" />
              <span className="text-[11px] text-muted-foreground/70 truncate">
                {pr.branch}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground/70">
              #{pr.prNumber}
            </span>
          </div>
        </div>
        {prInfo.isMerged ? (
          <a
            href={pr.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-muted-foreground hidden group-hover/pr:block flex-shrink-0 hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4 cursor-pointer" />
          </a>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              window.dispatchEvent(
                new CustomEvent('open-item-actions', {
                  detail: {
                    terminalId: null,
                    sessionId: null,
                    prNumber: pr.prNumber,
                    prRepo: pr.repo,
                  },
                }),
              )
            }}
            className="text-xs text-muted-foreground hidden group-hover/pr:block flex-shrink-0 hover:text-foreground transition-colors cursor-pointer"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
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
            onToggle={() => {}}
            hasNewActivity={hasNewActivity}
            onSeen={onSeen}
          />
        </div>
      )}
    </div>
  )
})
