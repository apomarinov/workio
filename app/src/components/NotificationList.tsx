import {
  NOTIFICATION_REGISTRY,
  resolveTemplate,
} from '@domains/notifications/registry'
import type { Notification } from '@domains/notifications/schema'
import type { LucideIcon } from 'lucide-react'
import {
  AtSign,
  Check,
  CircleCheck,
  CircleX,
  Eye,
  GitMerge,
  GitPullRequestArrow,
  MailCheck,
  MessageSquare,
  ShieldAlert,
  Terminal,
  Trash2,
  Undo2,
} from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { Button } from '@/components/ui/button'
import { useNotificationDataContext } from '@/context/NotificationDataContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { RefreshIcon } from './icons'

const ICON_MAP: Record<string, LucideIcon | typeof RefreshIcon> = {
  GitMerge,
  GitPullRequestArrow,
  CircleCheck,
  CircleX,
  RefreshIcon,
  Check,
  MessageSquare,
  Eye,
  AtSign,
  Terminal,
  ShieldAlert,
}

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
  const def = NOTIFICATION_REGISTRY[type]
  if (def?.icon) {
    const IconComp = ICON_MAP[def.icon]
    if (IconComp) {
      return <IconComp className={cn('w-4 h-4', def.iconColor)} />
    }
  }
  return <MessageSquare className="w-4 h-4 text-muted-foreground" />
}

// PR types where in-app list shows body as title and title as subtitle
const SWAP_TITLE_TYPES = new Set([
  'pr_merged',
  'pr_closed',
  'pr_approved',
  'changes_requested',
  'new_comment',
  'new_review',
])

function getNotificationTitle(notification: Notification): string {
  const def = NOTIFICATION_REGISTRY[notification.type]
  if (!def) return notification.type
  const template = SWAP_TITLE_TYPES.has(notification.type)
    ? def.bodyTemplate
    : def.titleTemplate
  return resolveTemplate(
    template,
    notification.data as unknown as Record<string, unknown>,
  )
}

function getNotificationSubtitle(notification: Notification): string {
  const def = NOTIFICATION_REGISTRY[notification.type]
  if (!def) return ''
  const template = SWAP_TITLE_TYPES.has(notification.type)
    ? def.titleTemplate
    : def.bodyTemplate
  return resolveTemplate(
    template,
    notification.data as unknown as Record<string, unknown>,
  )
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
    case 'review_requested':
      return data.prUrl
    case 'pr_mentioned':
      return data.commentUrl || data.prUrl
    default:
      return undefined
  }
}

function NotificationItem({
  notification,
  onMarkRead,
  onMarkUnread,
  onDelete,
  isMobile,
}: {
  notification: Notification
  onMarkRead: (id: number) => void
  onMarkUnread: (id: number) => void
  onDelete: (id: number) => void
  isMobile: boolean
}) {
  const { id, type, data, created_at, read } = notification
  const title = getNotificationTitle(notification)
  const subtitle = getNotificationSubtitle(notification)
  const url = getNotificationUrl(notification)
  const isWorkspace = type.startsWith('workspace_')
  const hasBody =
    (type === 'new_comment' ||
      type === 'new_review' ||
      type === 'pr_mentioned') &&
    data.body

  const handleClick = () => {
    if (!read) {
      onMarkRead(id)
    }
    if (isWorkspace) return // No URL to open for workspace notifications
    if (url) {
      window.open(url, '_blank')
    }
  }

  const handleToggleRead = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (read) {
      onMarkUnread(id)
    } else {
      onMarkRead(id)
    }
  }

  const handleDelete = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onDelete(id)
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'group relative w-full text-left py-1.5 min-h-[75px] px-2 rounded hover:bg-accent flex items-start gap-1.5',
        read && 'opacity-60',
        isWorkspace || !url ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      <div className="flex-shrink-0 mt-0.5 flex flex-col items-center gap-0.5">
        {getNotificationIcon(type)}
        <div className="flex flex-col gap-1.5">
          <div
            className={cn(
              'items-center justify-center w-4 h-4 mt-1 rounded hover:bg-zinc-700 text-muted-foreground hover:text-foreground',
              isMobile ? 'flex' : 'hidden group-hover:flex',
            )}
            onClick={handleToggleRead}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleToggleRead(e)
            }}
          >
            {read ? (
              <Undo2 className="w-3.5 h-3.5" />
            ) : (
              <MailCheck className="w-3.5 h-3.5" />
            )}
          </div>
          <div
            className={cn(
              'items-center justify-center w-4 h-4 text-muted-foreground hover:text-red-400',
              isMobile ? 'flex' : 'hidden group-hover:flex',
            )}
            onClick={handleDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
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
    </button>
  )
}

export function NotificationList() {
  const {
    notifications,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    deleteNotification,
    deleteAllNotifications,
    hasAnyUnseenPRs,
    hasUnreadNotifications,
  } = useNotificationDataContext()
  const isMobile = useIsMobile()

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
              onMarkUnread={markNotificationUnread}
              onDelete={deleteNotification}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
    </div>
  )
}
