import {
  CheckCircle,
  GitMerge,
  Loader2,
  MessageSquare,
  RefreshCw,
  Terminal,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTerminalContext } from '@/context/TerminalContext'
import type { Notification } from '@/types'

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
      return <GitMerge className="w-4 h-4 text-purple-500" />
    case 'check_failed':
      return <XCircle className="w-4 h-4 text-red-500" />
    case 'changes_requested':
      return <RefreshCw className="w-4 h-4 text-orange-500" />
    case 'pr_approved':
      return <CheckCircle className="w-4 h-4 text-green-500" />
    case 'new_comment':
    case 'new_review':
      return <MessageSquare className="w-4 h-4 text-blue-500" />
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
      return 'PR Merged'
    case 'check_failed':
      return data.checkName ? `Check failed: ${data.checkName}` : 'Check failed'
    case 'changes_requested':
      return data.reviewer
        ? `${data.reviewer} requested changes`
        : 'Changes requested'
    case 'pr_approved':
      return data.approver ? `${data.approver} approved` : 'PR approved'
    case 'new_comment':
      return data.author ? `${data.author} commented` : 'New comment'
    case 'new_review':
      return data.author ? `${data.author} reviewed` : 'New review'
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

function NotificationItem({ notification }: { notification: Notification }) {
  const { type, data, created_at, read } = notification
  const title = getNotificationTitle(notification)
  const isWorkspace = type.startsWith('workspace_')

  const handleClick = () => {
    if (isWorkspace) return // No URL to open for workspace notifications
    const url =
      type === 'check_failed'
        ? data.checkUrl || data.prUrl
        : type === 'new_comment'
          ? data.commentUrl || data.prUrl
          : type === 'new_review' && data.reviewId
            ? `${data.prUrl}#pullrequestreview-${data.reviewId}`
            : data.prUrl
    if (url) {
      window.open(url, '_blank')
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left py-1.5 px-2 rounded hover:bg-accent flex items-center gap-1.5 ${
        read ? 'opacity-60' : ''
      } ${isWorkspace ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <div className="flex-shrink-0">{getNotificationIcon(type)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {data.prTitle ? `${data.prTitle} · ` : ''}
          {formatRelativeTime(created_at)}
        </div>
      </div>
      {!read && (
        <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
      )}
    </button>
  )
}

export function NotificationList() {
  const {
    notifications,
    clearAllNotifications,
    clearingNotifications,
    hasUnreadNotifications,
  } = useTerminalContext()

  if (notifications.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No notifications
      </div>
    )
  }

  return (
    <div className="w-80">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">Notifications</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={clearAllNotifications}
          disabled={clearingNotifications || !hasUnreadNotifications}
        >
          {clearingNotifications ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : null}
          Clear all
        </Button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto p-1">
        {notifications.map((notification) => (
          <NotificationItem key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  )
}
