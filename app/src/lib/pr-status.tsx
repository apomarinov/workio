import {
  ArrowLeftRight,
  Check,
  CircleX,
  Clock,
  GitMerge,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import { RefreshIcon } from '@/components/icons'

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

  const isMerged = pr.state === 'MERGED'
  const isApproved = pr.reviewDecision === 'APPROVED'
  const hasChangesRequested = pr.reviewDecision === 'CHANGES_REQUESTED'
  const runningChecks = pr.checks.filter(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED',
  ).length
  const failedChecks = pr.checks.filter(
    (c) =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== 'NEUTRAL',
  ).length
  const hasConflicts = pr.mergeable === 'CONFLICTING'
  const hasPendingReviews =
    pr.reviews.filter((r) => r.state === 'PENDING').length > 0

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
  if (runningChecks > 0) {
    return {
      hasRunningChecks: true,
      label: `Running checks (${runningChecks})`,
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
  if (isApproved && (hasConflicts || failedChecks > 0)) {
    return {
      isApproved,
      hasConflicts,
      hasFailedChecks: failedChecks > 0,
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
  if (failedChecks > 0) {
    return {
      hasFailedChecks: true,
      label: `Failed checks (${failedChecks})`,
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
      <GitMerge
        className={cn(iconClass, `text-muted-foreground`, props?.cls)}
      />
    ),
  }
}
