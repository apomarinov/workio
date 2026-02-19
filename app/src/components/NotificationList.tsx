import {
  Check,
  CircleCheck,
  CircleX,
  Eye,
  GitMerge,
  GitPullRequestArrow,
  MailCheck,
  MessageSquare,
  Terminal,
  Trash2,
} from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { Button } from '@/components/ui/button'
import { useTerminalContext } from '@/context/TerminalContext'
import { cn } from '@/lib/utils'
import type { Notification } from '@/types'
import { RefreshIcon } from './icons'

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function getNotificationIcon(type: string) {
  switch (type) {
    case 'pr_merged':
      return <GitMerge className="w-4 h-4 text-purple-400" />
    case 'pr_closed':
      return <GitPullRequestArrow className="w-4 h-4 text-red-400" />
    case 'checks_passed':
      return <CircleCheck className="w-4 h-4 text-green-500" />
    case 'check_failed':
      return <CircleX className="w-4 h-4 text-red-400" />
    case 'changes_requested':
      return <RefreshIcon className="w-4 h-4 text-orange-400" />
    case 'pr_approved':
      return <Check className="w-4 h-4 text-green-500" />
    case 'new_comment':
      return <MessageSquare className="w-4 h-4 text-muted-foreground" />
    case 'new_review':
      return <Eye className="w-4 h-4 text-blue-500" />
    // Workspace notifications
    case 'workspace_ready':
    case 'workspace_deleted':
      return <Terminal className="w-4 h-4 text-green-500" />
    case 'workspace_failed':
    case 'workspace_repo_failed':
      return <Terminal className="w-4 h-4 text-red-500" />
    default:
      return <MessageSquare className="w-4 h-4 text-muted-foreground" />
  }
}

function getNotificationTitle(notification: Notification): string {
  const { type, data } = notification
  switch (type) {
    case 'pr_merged':
      return data.prTitle ? `Merged ${data.prTitle}` : 'PR Merged'
    case 'pr_closed':
      return data.prTitle ? `Closed ${data.prTitle}` : 'PR Closed'
    case 'checks_passed':
      return 'All checks passed'
    case 'check_failed':
      return data.checkName ? `${data.checkName} Failed` : 'Check failed'
    case 'changes_requested':
      return data.reviewer
        ? `${data.reviewer} requested changes`
        : 'Changes requested'
    case 'pr_approved':
      return data.approver ? `${data.approver} approved` : 'PR approved'
    case 'new_comment':
      return data.author ? `${data.author}` : 'New comment'
    case 'new_review':
      return data.author ? `${data.author} left a review` : 'New review'
    // Workspace notifications
    case 'workspace_ready':
      return `${data.name || 'Workspace'} is ready`
    case 'workspace_deleted':
      return `${data.name || 'Workspace'} deleted`
    case 'workspace_failed':
      return `${data.name || 'Workspace'} failed`
    case 'workspace_repo_failed':
      return `${data.name || 'Workspace'} repo init failed`
    default:
      return type
  }
}

function getNotificationSubtitle(notification: Notification): string {
  const { type, data, repo } = notification
  switch (type) {
    case 'pr_merged':
    case 'pr_closed':
      return repo
    case 'checks_passed':
    case 'check_failed':
    case 'changes_requested':
    case 'pr_approved':
    case 'new_comment':
    case 'new_review':
      return data.prTitle || repo
    default:
      return ''
  }
}

function getNotificationUrl(notification: Notification): string | undefined {
  const { type, data } = notification
  switch (type) {
    case 'pr_merged':
    case 'pr_closed':
      return data.prUrl
    case 'checks_passed':
      return data.prUrl
    case 'check_failed':
      return data.checkUrl || data.prUrl
    case 'changes_requested':
    case 'pr_approved':
      // For reviews, construct review URL if we have reviewId
      if (data.reviewId && data.prUrl) {
        return `${data.prUrl}#pullrequestreview-${data.reviewId}`
      }
      return data.prUrl
    case 'new_comment':
      return data.commentUrl || data.prUrl
    case 'new_review':
      if (data.reviewId && data.prUrl) {
        return `${data.prUrl}#pullrequestreview-${data.reviewId}`
      }
      return data.prUrl
    default:
      return undefined
  }
}

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification
  onMarkRead: (id: number) => void
}) {
  const { id, type, data, created_at, read } = notification
  const title = getNotificationTitle(notification)
  const subtitle = getNotificationSubtitle(notification)
  const url = getNotificationUrl(notification)
  const isWorkspace = type.startsWith('workspace_')
  const hasBody = (type === 'new_comment' || type === 'new_review') && data.body

  const handleClick = () => {
    if (!read) {
      onMarkRead(id)
    }
    if (isWorkspace) return // No URL to open for workspace notifications
    if (url) {
      window.open(url, '_blank')
    }
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'group relative w-full text-left py-1.5 px-2 rounded hover:bg-accent flex items-start gap-1.5',
        read && 'opacity-60',
        isWorkspace || !url ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      <div className="flex-shrink-0 mt-0.5">{getNotificationIcon(type)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium line-clamp-3">
          <MarkdownContent content={title} />
        </div>
        {hasBody && (
          <div className="text-xs text-muted-foreground line-clamp-4 mt-0.5 [&_p]:mb-0 [&_pre]:hidden [&_code]:text-[10px]">
            <MarkdownContent content={data.body || ''} />
          </div>
        )}
        <div
          className={cn(
            'flex flex-col pt-0.5 mt-0.5',
            hasBody && 'border-t-[1px]',
          )}
        >
          <div className="text-xs text-muted-foreground line-clamp-5">
            {subtitle && <MarkdownContent content={subtitle} />}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(created_at)}
          </span>
        </div>
      </div>
      {!read && (
        <div
          className="absolute top-1 right-1"
          onClick={(e) => {
            e.stopPropagation()
            onMarkRead(id)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation()
              onMarkRead(id)
            }
          }}
        >
          <div className="w-1.5 h-1.5 mt-2 mr-1 rounded-full bg-green-500 group-hover:hidden" />
          <div className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-700 text-muted-foreground hover:text-foreground">
            <Check className="w-3 h-3" />
          </div>
        </div>
      )}
    </button>
  )
}

export function NotificationList() {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteAllNotifications,
    hasAnyUnseenPRs,
    hasUnreadNotifications,
  } = useTerminalContext()

  return (
    <div className="w-[330px]">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">Notifications</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={markAllNotificationsRead}
            disabled={!hasUnreadNotifications && !hasAnyUnseenPRs}
          >
            <MailCheck className="w-3.5 h-3.5" />
          </Button>
          {notifications.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={deleteAllNotifications}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      {notifications.length > 0 && (
        <div className="max-h-[28rem] overflow-y-auto p-1">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={markNotificationRead}
            />
          ))}
        </div>
      )}
    </div>
  )
}
