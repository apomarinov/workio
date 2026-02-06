import {
  ArrowLeftRight,
  Check,
  CircleX,
  Clock,
  GitMerge,
  GitPullRequestArrow,
  Loader2,
} from 'lucide-react'
import { RefreshIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'

export function getPRStatusInfo(pr?: PRCheckStatus) {
  const iconClass = 'w-5 h-5'
  if (!pr) {
    return {
      label: '',
      colorClass: 'hidden',
      dimColorClass: '',
      icon: () => <div className="hidden"></div>,
    }
  }

  // Use pre-computed flags from server
  const {
    isMerged,
    isApproved,
    hasChangesRequested,
    hasConflicts,
    hasPendingReviews,
    runningChecksCount,
    failedChecksCount,
  } = pr

  if (isMerged) {
    return {
      isMerged,
      label: 'Merged',
      colorClass: 'text-purple-400',
      dimColorClass: 'text-purple-400/60 hover:text-purple-400',
      icon: (props?: { cls?: string; group?: string }) => (
        <GitMerge
          className={cn(
            iconClass,
            `text-purple-400/70 ${props?.group ? `${props.group}:text-purple-400` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (runningChecksCount > 0) {
    return {
      hasRunningChecks: true,
      label: `Running checks (${runningChecksCount})`,
      colorClass: 'text-yellow-400',
      dimColorClass: 'text-yellow-400/60 hover:text-yellow-400',
      icon: (props?: { cls?: string; group?: string }) => (
        <Loader2
          className={cn(
            iconClass,
            `text-yellow-400 animate-spin ${props?.group ? `${props.group}:text-yellow-400` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (hasChangesRequested) {
    return {
      hasChangesRequested,
      label: 'Change request',
      colorClass: 'text-orange-400',
      dimColorClass: 'text-orange-400/60 hover:text-orange-400',
      icon: (props?: { cls?: string; group?: string }) => (
        <RefreshIcon
          className={cn(
            iconClass,
            `text-orange-400/70 ${props?.group ? `${props.group}:text-orange-400` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (isApproved && (hasConflicts || failedChecksCount > 0)) {
    return {
      isApproved,
      hasConflicts,
      hasFailedChecks: failedChecksCount > 0,
      label: hasConflicts ? 'Conflicts' : 'Failed Checks',
      colorClass: 'text-red-400',
      dimColorClass: 'text-red-400/60 hover:text-red-400',
      icon: (props?: { cls?: string; group?: string }) => (
        <Check
          className={cn(
            iconClass,
            `text-red-400/70 ${props?.group ? `${props.group}:text-red-400` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (isApproved) {
    return {
      isApproved,
      label: 'Approved',
      colorClass: 'text-green-500',
      dimColorClass: 'text-green-500/60 hover:text-green-500',
      icon: (props?: { cls?: string; group?: string }) => (
        <Check
          className={cn(
            iconClass,
            `text-green-500/70 ${props?.group ? `${props.group}:text-green-500` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (hasConflicts) {
    return {
      hasConflicts,
      label: 'Conflicts',
      colorClass: 'text-red-400',
      dimColorClass: 'text-red-400/60 hover:text-red-400',
      icon: (props?: { cls?: string; group?: string }) => {
        return (
          <ArrowLeftRight
            className={cn(
              iconClass,
              `text-red-400/70 ${props?.group ? `${props.group}:text-red-400` : ''}`,
              props?.cls,
            )}
          />
        )
      },
    }
  }
  if (failedChecksCount > 0) {
    return {
      hasFailedChecks: true,
      label: `Failed checks (${failedChecksCount})`,
      colorClass: 'text-red-400',
      dimColorClass: 'text-red-400/60 hover:text-red-400',
      icon: (props?: { cls?: string; group?: string }) => (
        <CircleX
          className={cn(
            iconClass,
            `text-red-400/70 ${props?.group ? `${props.group}:text-red-400` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (pr.areAllChecksOk) {
    return {
      areAllChecksOk: true,
      label: 'Checks passed',
      colorClass: '',
      dimColorClass: '',
      icon: (props?: { cls?: string; group?: string }) => (
        <Check
          className={cn(
            iconClass,
            `text-muted-foreground/70 ${props?.group ? `${props.group}:text-muted-foreground` : ''}`,
            props?.cls,
          )}
        />
      ),
    }
  }
  if (hasPendingReviews) {
    return {
      hasPendingReviews,
      label: 'Pending Reviews',
      colorClass: '',
      dimColorClass: '',
      icon: (props?: { cls?: string; group?: string }) => (
        <Clock className={cn(iconClass, `text-muted-foreground`, props?.cls)} />
      ),
    }
  }
  return {
    label: 'Pull Request',
    colorClass: '',
    dimColorClass: '',
    icon: (props?: { cls?: string; group?: string }) => (
      <GitPullRequestArrow
        className={cn(iconClass, `text-muted-foreground`, props?.cls)}
      />
    ),
  }
}
