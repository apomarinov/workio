import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  MoreVertical,
} from 'lucide-react'
import { memo } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import { PRStatusContent, PRTabButton } from './PRStatusContent'

interface PRStatusGroupProps {
  pr: PRCheckStatus
  expanded: boolean
  onToggle: () => void
  hasNewActivity?: boolean
  isActive?: boolean
}

export const PRStatusGroup = memo(function PRStatusGroup({
  pr,
  expanded,
  onToggle,
  hasNewActivity,
  isActive,
}: PRStatusGroupProps) {
  const prInfo = getPRStatusInfo(pr)
  const isMobile = useIsMobile()

  return (
    <div data-pr-branch={pr.branch}>
      <div
        onClick={() => {
          if (!prInfo.isMerged) {
            onToggle()
          }
        }}
        className={cn(
          'group/pr flex relative items-center gap-2 pr-3 pl-2 py-1.5 transition-colors min-w-0',
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
          prInfo.isClosed ||
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
        <div className="flex-1 min-w-0 flex flex-col">
          <span
            className={cn(
              'text-xs font-medium flex items-center gap-1.5',
              !expanded && 'truncate',
            )}
          >
            {hasNewActivity && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            )}
            <span className={cn(!expanded && 'truncate')}>{pr.prTitle}</span>
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
          {pr.baseBranch &&
            pr.baseBranch !== 'main' &&
            pr.baseBranch !== 'master' && (
              <span className="text-[10px] text-muted-foreground/70">
                &rarr; {pr.baseBranch}
              </span>
            )}
        </div>
        {prInfo.isMerged ? (
          <a
            href={pr.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'text-xs text-muted-foreground flex-shrink-0 hover:text-foreground transition-colors',
              isMobile ? 'block' : 'hidden group-hover/pr:block',
            )}
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
            className="absolute right-2 text-xs text-muted-foreground sm:hidden sm:group-hover/pr:block flex-shrink-0 hover:text-foreground transition-colors cursor-pointer bg-sidebar-accent/60 hover:bg-sidebar-accent py-1 rounded-sm"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
      </div>
      {!prInfo.isMerged && expanded && (
        <div className="ml-2">
          <PRTabButton
            pr={pr}
            withIcon
            active
            className="whitespace-nowrap mt-1"
          />
          <PRStatusContent
            pr={pr}
            expanded
            onToggle={() => {}}
            hasNewActivity={hasNewActivity}
          />
        </div>
      )}
    </div>
  )
})
