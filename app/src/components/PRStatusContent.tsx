import {
  BellOff,
  Check,
  ChevronDown,
  CircleX,
  Clock,
  File,
  Loader2,
  MailCheck,
  Maximize2,
  MessageSquare,
  Reply,
  Smile,
} from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTerminalContext } from '@/context/TerminalContext'
import { useSettings } from '@/hooks/useSettings'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type {
  PRCheckStatus,
  PRDiscussionItem,
  PRReaction,
  PRReview,
  PRReviewThread,
} from '../../shared/types'
import * as api from '../lib/api'
import {
  ContentDialog,
  HideAuthorDialog,
  MergeDialog,
  ReplyDialog,
  ReReviewDialog,
  RerunAllChecksDialog,
  RerunCheckDialog,
} from './dialogs'
import { RefreshIcon } from './icons'
import { MarkdownContent } from './MarkdownContent'

function formatTimeAgo(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

const REACTIONS = [
  { content: '+1', emoji: '👍' },
  { content: '-1', emoji: '👎' },
  { content: 'laugh', emoji: '😄' },
  { content: 'hooray', emoji: '🎉' },
  { content: 'confused', emoji: '😐' },
  { content: 'heart', emoji: '❤️' },
  { content: 'rocket', emoji: '🚀' },
  { content: 'eyes', emoji: '👀' },
]

function ReactionBadges({
  reactions,
  onReact,
}: {
  reactions: PRReaction[]
  onReact?: (content: string, remove: boolean) => void
}) {
  const { ghUsername } = useTerminalContext()
  if (reactions.length === 0) return null
  return (
    <div className="flex flex-wrap gap-0.5 px-2 py-0.5">
      {reactions.map((r) => {
        const emoji =
          REACTIONS.find((re) => re.content === r.content)?.emoji || r.content
        const tooltipUsers = r.users.map((u) =>
          ghUsername && u === ghUsername ? 'you' : u,
        )
        return (
          <Tooltip key={r.content}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onReact?.(r.content, r.viewerHasReacted)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] transition-colors cursor-pointer border',
                  r.viewerHasReacted
                    ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                    : 'bg-sidebar-accent/40 text-muted-foreground border-transparent hover:bg-sidebar-accent/70',
                )}
              >
                <span className="text-xs leading-none">{emoji}</span>
                <span>{r.count}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {tooltipUsers.join(', ')}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export const PRTabButton = memo(function PRTabButton({
  pr,
  active = false,
  hasNewActivity,
  onClick,
  withIcon,
  className,
}: {
  pr: PRCheckStatus
  active?: boolean
  hasNewActivity?: boolean
  withIcon?: boolean
  className?: string
  onClick?: () => void
}) {
  const { label, colorClass, dimColorClass, icon } = useMemo(
    () => getPRStatusInfo(pr),
    [pr],
  )

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'text-[10px] flex items-center uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors cursor-pointer',
          active
            ? cn(colorClass || 'text-foreground', 'bg-sidebar-accent')
            : cn(
                dimColorClass ||
                  'text-muted-foreground/60 hover:text-muted-foreground',
              ),
          className,
        )}
      >
        {withIcon && icon({ cls: 'w-2.5 h-2.5 mr-1' })}
        {label}
        {hasNewActivity && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 ml-1 align-middle" />
        )}
      </button>
    </div>
  )
})

interface PRStatusContentProps {
  pr: PRCheckStatus
  expanded?: boolean
  onToggle?: () => void
  hasNewActivity?: boolean
  unreadItemIds?: Set<string>
}

const ReviewRow = memo(function ReviewRow({
  review,
  icon,
  prUrl,
  showReReview,
  isApproved,
  hasConflicts,
  onReReview,
  onMerge,
  onReply,
  onReact,
  onMarkRead,
}: {
  review: PRReview
  icon: React.ReactNode
  prUrl: string
  showReReview?: boolean
  isApproved?: boolean
  hasConflicts?: boolean
  onReReview: (author: string) => void
  onMerge?: () => void
  onReply: (author: string, reviewCommentId?: number) => void
  onReact?: (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => void
  onMarkRead?: () => void
}) {
  const [bodyOpen, setBodyOpen] = useState(false)

  const handleReReview = useCallback(
    () => onReReview(review.author),
    [onReReview, review.author],
  )

  const handleReply = useCallback(
    () => onReply(review.author),
    [onReply, review.author],
  )

  const handleMarkRead = () => {
    if (review.isUnread && onMarkRead) onMarkRead()
  }

  const reviewUrl = review.url || prUrl

  return (
    <div className="group/review px-2 py-1 rounded text-sidebar-foreground/70">
      <div className="flex items-center gap-1.5">
        <a
          href={reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 min-w-0 py-1 flex-1 hover:bg-sidebar-accent/30 rounded transition-colors cursor-pointer"
          onClick={handleMarkRead}
        >
          {icon}
          {review.isUnread && (
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
          )}
          {review.avatarUrl ? (
            <img
              src={review.avatarUrl}
              alt={review.author}
              className="w-4 h-4 rounded-full flex-shrink-0"
            />
          ) : (
            <div className="w-4 h-4 rounded-full bg-zinc-600 flex-shrink-0" />
          )}
          <span className="text-xs truncate">{review.author}</span>
        </a>
        {onReact && review.body && review.id && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/review:opacity-100 transition-opacity cursor-pointer"
              >
                {review.reactions?.find((r) => r.viewerHasReacted) ? (
                  <span className="text-xs leading-none">
                    {REACTIONS.find(
                      (re) =>
                        re.content ===
                        review.reactions!.find((r) => r.viewerHasReacted)!
                          .content,
                    )?.emoji || '😀'}
                  </span>
                ) : (
                  <Smile className="w-3 h-3" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-1" side="top" align="center">
              <div className="flex gap-0.5">
                {REACTIONS.map((r) => {
                  const existing = review.reactions?.find(
                    (re) => re.content === r.content,
                  )
                  return (
                    <PopoverClose key={r.content} asChild>
                      <button
                        type="button"
                        onClick={() =>
                          onReact(
                            review.id!,
                            'review',
                            r.content,
                            existing?.viewerHasReacted,
                          )
                        }
                        className={cn(
                          'rounded p-1 text-sm cursor-pointer transition-colors',
                          existing?.viewerHasReacted
                            ? 'bg-blue-500/15'
                            : 'hover:bg-sidebar-accent',
                        )}
                      >
                        {r.emoji}
                      </button>
                    </PopoverClose>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <button
          type="button"
          onClick={handleReply}
          className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/review:opacity-100 transition-opacity cursor-pointer"
        >
          <Reply className="w-3.5 h-3.5" />
        </button>
        {showReReview && (
          <button
            type="button"
            onClick={handleReReview}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/review:opacity-100 transition-opacity cursor-pointer"
          >
            <RefreshIcon className="w-3.5 h-3.5" />
          </button>
        )}
        {isApproved && onMerge && (
          <button
            type="button"
            onClick={() => onMerge()}
            disabled={hasConflicts}
            className={cn(
              'text-[10px] flex-shrink-0 opacity-0 group-hover/review:opacity-100 transition-opacity pr-2',
              hasConflicts
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : 'text-muted-foreground/50 hover:text-muted-foreground cursor-pointer',
            )}
            title={hasConflicts ? 'Cannot merge: PR has conflicts' : undefined}
          >
            Merge PR
          </button>
        )}
      </div>
      {review.body && (
        <div
          onClick={() => {
            setBodyOpen(true)
            handleMarkRead()
          }}
          className="mt-1 text-xs line-clamp-3 cursor-pointer hover:bg-sidebar-accent/30 rounded p-1 transition-colors"
        >
          <MarkdownContent content={review.body} />
        </div>
      )}
      {review.reactions && review.reactions.length > 0 && (
        <ReactionBadges
          reactions={review.reactions}
          onReact={
            onReact && review.id
              ? (content, remove) =>
                  onReact(review.id!, 'review', content, remove)
              : undefined
          }
        />
      )}
      {review.body && bodyOpen && (
        <ContentDialog
          author={review.author}
          avatarUrl={review.avatarUrl}
          content={review.body}
          onClose={() => setBodyOpen(false)}
        />
      )}
    </div>
  )
})

const CommentItem = memo(function CommentItem({
  comment,
  prUrl,
  onHide,
  onReply,
  onReact,
  onMarkRead,
  hidePath,
  indent,
  defaultExpanded,
  largeText,
}: {
  comment: {
    id?: number
    url?: string
    author: string
    avatarUrl: string
    body: string
    createdAt: string
    path?: string
    isUnread?: boolean
    reactions?: PRReaction[]
  }
  prUrl: string
  onHide: (author: string) => void
  onReply: (author: string, reviewCommentId?: number) => void
  onReact?: (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => void
  onMarkRead?: () => void
  hidePath?: boolean
  indent?: boolean
  defaultExpanded?: boolean
  largeText?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const [modalOpen, setModalOpen] = useState(false)

  const handleHide = useCallback(
    () => onHide(comment.author),
    [onHide, comment.author],
  )

  const handleReply = useCallback(
    () => onReply(comment.author),
    [onReply, comment.author],
  )

  const handleMarkRead = () => {
    if (comment.isUnread && onMarkRead) onMarkRead()
  }

  const commentUrl = comment.url || prUrl

  return (
    <>
      <div
        className={cn(
          'group/comment px-2 py-1 rounded text-sidebar-foreground/70',
          indent && 'ml-4',
        )}
      >
        <div className="flex items-center gap-1.5">
          {!defaultExpanded && (
            <button
              type="button"
              onClick={() => {
                setExpanded(!expanded)
                handleMarkRead()
              }}
              className="flex items-center gap-0 min-w-0 cursor-pointer"
            >
              <ChevronDown
                className={cn(
                  'w-3 h-3 flex-shrink-0 transition-transform',
                  !expanded && '-rotate-90',
                )}
              />
            </button>
          )}
          {comment.isUnread && (
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
          )}
          <a
            href={commentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 min-w-0 flex-1 hover:bg-sidebar-accent/30 rounded transition-colors cursor-pointer"
            onClick={handleMarkRead}
          >
            {comment.avatarUrl ? (
              <img
                src={comment.avatarUrl}
                alt={comment.author}
                className="w-4 h-4 rounded-full flex-shrink-0"
              />
            ) : (
              <div className="w-4 h-4 rounded-full bg-zinc-600 flex-shrink-0" />
            )}
            <span className="text-xs font-medium truncate">
              {comment.author}
            </span>
          </a>
          {onReact && comment.id && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity cursor-pointer"
                >
                  {comment.reactions?.find((r) => r.viewerHasReacted) ? (
                    <span className="text-xs leading-none">
                      {REACTIONS.find(
                        (re) =>
                          re.content ===
                          comment.reactions!.find((r) => r.viewerHasReacted)!
                            .content,
                      )?.emoji || '😀'}
                    </span>
                  ) : (
                    <Smile className="w-3 h-3" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-1" side="top" align="center">
                <div className="flex gap-0.5">
                  {REACTIONS.map((r) => {
                    const existing = comment.reactions?.find(
                      (re) => re.content === r.content,
                    )
                    return (
                      <PopoverClose key={r.content} asChild>
                        <button
                          type="button"
                          onClick={() =>
                            onReact(
                              comment.id!,
                              comment.path ? 'review_comment' : 'issue_comment',
                              r.content,
                              existing?.viewerHasReacted,
                            )
                          }
                          className={cn(
                            'rounded p-1 text-sm cursor-pointer transition-colors',
                            existing?.viewerHasReacted
                              ? 'bg-blue-500/15'
                              : 'hover:bg-sidebar-accent',
                          )}
                        >
                          {r.emoji}
                        </button>
                      </PopoverClose>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <button
            type="button"
            onClick={handleReply}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity cursor-pointer"
          >
            <Reply className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleHide}
            className="text-muted-foreground/30 mt- hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity cursor-pointer"
          >
            <BellOff className="w-3 h-3" />
          </button>
        </div>
        <div
          onClick={() => {
            setModalOpen(true)
            handleMarkRead()
          }}
          className={cn(
            'mt-1 cursor-pointer hover:bg-sidebar-accent/30 rounded px-1 py-0.5 transition-colors',
            largeText ? 'text-sm' : 'text-xs',
          )}
        >
          {!hidePath && comment.path && (
            <span className="text-[10px] flex items-center gap-1 text-muted-foreground/50 truncate">
              <File className="w-2 h-2 min-w-2 min-h-2" />
              {comment.path}
            </span>
          )}
          <div className={cn(!expanded && 'line-clamp-1 leading-[1.5]')}>
            <MarkdownContent content={comment.body} />
          </div>
        </div>
        {comment.reactions && comment.reactions.length > 0 && (
          <ReactionBadges
            reactions={comment.reactions}
            onReact={
              onReact && comment.id
                ? (content, remove) =>
                    onReact(
                      comment.id!,
                      comment.path ? 'review_comment' : 'issue_comment',
                      content,
                      remove,
                    )
                : undefined
            }
          />
        )}
      </div>

      {modalOpen && (
        <ContentDialog
          author={comment.author}
          avatarUrl={comment.avatarUrl}
          content={comment.body}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
})

function ReviewThreadGroup({
  thread,
  prUrl,
  pr,
  onHide,
  onReply,
  onReact,
  defaultExpanded,
  largeText,
}: {
  thread: PRReviewThread
  prUrl: string
  pr?: PRCheckStatus
  onHide: (author: string) => void
  onReply: (author: string, reviewCommentId?: number) => void
  onReact?: (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => void
  defaultExpanded?: boolean
  largeText?: boolean
}) {
  const [showAllReplies, setShowAllReplies] = useState(false)
  const { markNotificationReadByItem } = useTerminalContext()
  const [root, ...replies] = thread.comments
  if (!root) return null

  const REPLY_LIMIT = defaultExpanded ? 1000 : 3
  const sortedReplies = [...replies].reverse()
  const hasMoreReplies = sortedReplies.length > REPLY_LIMIT
  const firstReplies = sortedReplies.slice(0, REPLY_LIMIT)
  const remainingReplies = sortedReplies.slice(REPLY_LIMIT)

  // Wrap onReply to include the root comment ID for review thread replies
  const handleThreadReply = (author: string) => onReply(author, root.id)

  return (
    <div>
      {thread.path && (
        <span className="text-[10px] flex items-center gap-1 text-muted-foreground/50 truncate px-2 pt-1">
          <File className="w-2 h-2 min-w-2 min-h-2" />
          {thread.path}
        </span>
      )}
      <CommentItem
        comment={root}
        prUrl={prUrl}
        onHide={onHide}
        onReply={handleThreadReply}
        onReact={onReact}
        onMarkRead={
          pr && root.isUnread && root.id
            ? () => markNotificationReadByItem(pr.repo, pr.prNumber, root.id)
            : undefined
        }
        hidePath
        defaultExpanded={defaultExpanded}
        largeText={largeText}
      />
      {firstReplies.map((reply, i) => (
        <CommentItem
          key={reply.id || i}
          comment={reply}
          prUrl={prUrl}
          onHide={onHide}
          onReply={handleThreadReply}
          onReact={onReact}
          onMarkRead={
            pr && reply.isUnread && reply.id
              ? () => markNotificationReadByItem(pr.repo, pr.prNumber, reply.id)
              : undefined
          }
          hidePath
          indent
          defaultExpanded={defaultExpanded}
          largeText={largeText}
        />
      ))}
      {hasMoreReplies && (
        <button
          type="button"
          onClick={() => setShowAllReplies((v) => !v)}
          className="flex items-center gap-1 ml-4 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronDown
            className={cn(
              'w-3 h-3 transition-transform',
              !showAllReplies && '-rotate-90',
            )}
          />
          {showAllReplies
            ? 'Show less'
            : `Show all (${replies.length} replies)`}
        </button>
      )}
      {showAllReplies &&
        remainingReplies.map((reply, i) => (
          <CommentItem
            key={reply.id || i}
            comment={reply}
            prUrl={prUrl}
            onHide={onHide}
            onReply={handleThreadReply}
            onReact={onReact}
            onMarkRead={
              pr && reply.isUnread && reply.id
                ? () =>
                    markNotificationReadByItem(pr.repo, pr.prNumber, reply.id)
                : undefined
            }
            hidePath
            indent
            defaultExpanded={defaultExpanded}
            largeText={largeText}
          />
        ))}
    </div>
  )
}

function getReviewIcon(state: string): React.ReactNode {
  switch (state) {
    case 'APPROVED':
      return <Check className="w-3 h-3 flex-shrink-0 text-green-500" />
    case 'CHANGES_REQUESTED':
      return <RefreshIcon className="w-3 h-3 flex-shrink-0 text-orange-400" />
    case 'PENDING':
      return <Clock className="w-3 h-3 flex-shrink-0 text-zinc-500" />
    default:
      return <MessageSquare className="w-3 h-3 flex-shrink-0 text-zinc-500" />
  }
}

function getLatestActivityTime(item: PRDiscussionItem): number {
  switch (item.type) {
    case 'review':
      return item.review.submittedAt
        ? new Date(item.review.submittedAt).getTime()
        : 0
    case 'comment':
      return new Date(item.comment.createdAt).getTime()
    case 'thread': {
      const last = item.thread.comments[item.thread.comments.length - 1]
      return last ? new Date(last.createdAt).getTime() : 0
    }
  }
}

type CollapsedGroup = {
  type: 'collapsed-group'
  author: string
  avatarUrl: string
  items: Extract<PRDiscussionItem, { type: 'comment' }>[]
}

type DisplayItem = PRDiscussionItem | CollapsedGroup

function flattenDiscussion(discussion: PRDiscussionItem[]): PRDiscussionItem[] {
  const items: PRDiscussionItem[] = []
  for (const item of discussion) {
    if (item.type === 'review') {
      items.push({ type: 'review', review: item.review, threads: [] })
      for (const thread of item.threads) {
        items.push({ type: 'thread', thread })
      }
    } else {
      items.push(item)
    }
  }
  items.sort((a, b) => getLatestActivityTime(b) - getLatestActivityTime(a))
  return items
}

function CollapsedAuthorGroup({
  group,
  prUrl,
  onReply,
  onHide,
  onReact,
}: {
  group: CollapsedGroup
  prUrl: string
  onReply: (author: string, reviewCommentId?: number) => void
  onHide: (author: string) => void
  onReact?: (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-pointer"
      >
        <ChevronDown
          className={cn(
            'w-3 h-3 flex-shrink-0 transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        {group.avatarUrl ? (
          <img
            src={group.avatarUrl}
            alt={group.author}
            className="w-4 h-4 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-4 h-4 rounded-full bg-zinc-600 flex-shrink-0" />
        )}
        <span className="text-xs truncate">{group.author}</span>
        <span className="text-[10px] text-muted-foreground/50">
          ({group.items.length} comments)
        </span>
      </button>
      {expanded &&
        group.items.map((item, i) => (
          <CommentItem
            key={`comment-${item.comment.id || i}`}
            comment={item.comment}
            prUrl={prUrl}
            onHide={onHide}
            onReply={onReply}
            onReact={onReact}
          />
        ))}
    </div>
  )
}

function FullDiscussionDialog({
  groupedDiscussion,
  pr,
  onReply,
  onHide,
  onReact,
  onReReview,
  onMerge,
  onClose,
}: {
  groupedDiscussion: DisplayItem[]
  pr: PRCheckStatus
  onReply: (author: string, reviewCommentId?: number) => void
  onHide: (author: string) => void
  onReact?: (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => void
  onReReview: (author: string) => void
  onMerge: () => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  const { markNotificationReadByItem } = useTerminalContext()

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setOpen(false)
      setTimeout(onClose, 300)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Discussion</DialogTitle>
        </DialogHeader>
        <div className="space-y-0.5 min-w-0">
          {groupedDiscussion.map((item, i) => {
            switch (item.type) {
              case 'collapsed-group':
                return (
                  <CollapsedAuthorGroup
                    key={`collapsed-${item.author}-${i}`}
                    group={item}
                    prUrl={pr.prUrl}
                    onReply={onReply}
                    onHide={onHide}
                    onReact={onReact}
                  />
                )
              case 'review':
                return (
                  <div key={`review-${item.review.id || i}`}>
                    <ReviewRow
                      review={item.review}
                      icon={getReviewIcon(item.review.state)}
                      prUrl={pr.prUrl}
                      showReReview={item.review.state === 'CHANGES_REQUESTED'}
                      isApproved={item.review.state === 'APPROVED'}
                      hasConflicts={pr.hasConflicts}
                      onReReview={onReReview}
                      onMerge={
                        item.review.state === 'APPROVED' ? onMerge : undefined
                      }
                      onReply={onReply}
                      onReact={onReact}
                      onMarkRead={
                        item.review.isUnread && item.review.id
                          ? () =>
                              markNotificationReadByItem(
                                pr.repo,
                                pr.prNumber,
                                undefined,
                                item.review.id,
                              )
                          : undefined
                      }
                    />
                    {item.threads.map((thread, ti) => (
                      <div
                        key={`thread-${thread.comments[0]?.id || ti}`}
                        className="ml-2 border-l border-sidebar-border pl-2"
                      >
                        <ReviewThreadGroup
                          thread={thread}
                          prUrl={pr.prUrl}
                          pr={pr}
                          onHide={onHide}
                          onReply={onReply}
                          onReact={onReact}
                          defaultExpanded
                          largeText
                        />
                      </div>
                    ))}
                  </div>
                )
              case 'comment':
                return (
                  <CommentItem
                    key={`comment-${item.comment.id || i}`}
                    comment={item.comment}
                    prUrl={pr.prUrl}
                    onHide={onHide}
                    onReply={onReply}
                    onReact={onReact}
                    onMarkRead={
                      item.comment.isUnread && item.comment.id
                        ? () =>
                            markNotificationReadByItem(
                              pr.repo,
                              pr.prNumber,
                              item.comment.id,
                            )
                        : undefined
                    }
                    defaultExpanded
                    largeText
                  />
                )
              case 'thread':
                return (
                  <ReviewThreadGroup
                    key={`standalone-${item.thread.comments[0]?.id || i}`}
                    thread={item.thread}
                    prUrl={pr.prUrl}
                    pr={pr}
                    onHide={onHide}
                    onReply={onReply}
                    onReact={onReact}
                    defaultExpanded
                    largeText
                  />
                )
              default:
                return null
            }
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DiscussionTimeline({
  discussion,
  pr,
  hiddenAuthorsSet,
  collapsedAuthorsSet,
  onReReview,
  onMerge,
  onReply,
  onHide,
  onReact,
}: {
  discussion: PRDiscussionItem[]
  pr: PRCheckStatus
  hiddenAuthorsSet: Set<string>
  collapsedAuthorsSet: Set<string>
  onReReview: (author: string) => void
  onMerge: () => void
  onReply: (author: string, reviewCommentId?: number) => void
  onHide: (author: string) => void
  onReact?: (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => void
}) {
  const [visibleCount, setVisibleCount] = useState(5)
  const [fullViewOpen, setFullViewOpen] = useState(false)
  const [discussionOpen, setDiscussionOpen] = useState(true)
  const { markPRNotificationsRead, markNotificationReadByItem } =
    useTerminalContext()
  const [displayMode, setDisplayMode] = useState<'threads' | 'latest'>(() => {
    const stored = localStorage.getItem('discussion-display-mode')
    return stored === 'threads' ? 'threads' : 'latest'
  })
  const handleDisplayModeChange = useCallback((v: string) => {
    const mode = v as 'threads' | 'latest'
    setDisplayMode(mode)
    localStorage.setItem('discussion-display-mode', mode)
  }, [])

  const processedDiscussion = useMemo(() => {
    const items =
      displayMode === 'latest' ? flattenDiscussion(discussion) : discussion
    return items.filter((item) => {
      if (item.type === 'comment') {
        return !hiddenAuthorsSet.has(item.comment.author)
      }
      return true
    })
  }, [discussion, hiddenAuthorsSet, displayMode])

  const groupedDiscussion: DisplayItem[] = useMemo(() => {
    if (collapsedAuthorsSet.size === 0) return processedDiscussion
    const result: DisplayItem[] = []
    let i = 0
    while (i < processedDiscussion.length) {
      const item = processedDiscussion[i]
      if (
        item.type === 'comment' &&
        collapsedAuthorsSet.has(item.comment.author)
      ) {
        const author = item.comment.author
        const group: Extract<PRDiscussionItem, { type: 'comment' }>[] = [item]
        let j = i + 1
        while (j < processedDiscussion.length) {
          const next = processedDiscussion[j]
          if (next.type !== 'comment' || next.comment.author !== author) break
          group.push(next)
          j++
        }
        if (group.length >= 2) {
          result.push({
            type: 'collapsed-group',
            author,
            avatarUrl: item.comment.avatarUrl,
            items: group,
          })
        } else {
          result.push(item)
        }
        i = j
      } else {
        result.push(item)
        i++
      }
    }
    return result
  }, [processedDiscussion, collapsedAuthorsSet])

  const visibleDiscussion = useMemo(
    () => groupedDiscussion.slice(0, visibleCount),
    [groupedDiscussion, visibleCount],
  )
  const hasMore = visibleCount < groupedDiscussion.length

  if (groupedDiscussion.length === 0) return null

  return (
    <>
      <div className="px-2 pb-1 flex justify-between items-center">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDiscussionOpen((v) => !v)}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-white transition-colors cursor-pointer"
          >
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                !discussionOpen && '-rotate-90',
              )}
            />
            Discussion
          </button>
          {pr.hasUnreadNotifications && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0.5 text-muted-foreground hover:text-white"
              onClick={() => markPRNotificationsRead(pr.repo, pr.prNumber)}
            >
              <MailCheck className="max-h-3 max-w-3" />
            </Button>
          )}
        </div>
        <div className="flex gap-1">
          <Select value={displayMode} onValueChange={handleDisplayModeChange}>
            <SelectTrigger
              size="sm"
              className="!h-5 !bg-transparent text-muted-foreground hover:text-white hover:!bg-input/30 text-[10px] border-none shadow-none px-1.5 gap-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="threads" className="text-xs">
                Threads
              </SelectItem>
              <SelectItem value="latest" className="text-xs">
                Latest
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0.5 text-muted-foreground hover:text-white"
            onClick={() => setFullViewOpen(true)}
          >
            <Maximize2 className="max-h-3 max-w-3" />
          </Button>
        </div>
      </div>
      {fullViewOpen && (
        <FullDiscussionDialog
          groupedDiscussion={groupedDiscussion}
          pr={pr}
          onReply={onReply}
          onHide={onHide}
          onReact={onReact}
          onReReview={onReReview}
          onMerge={onMerge}
          onClose={() => setFullViewOpen(false)}
        />
      )}
      {discussionOpen && (
        <>
          {visibleDiscussion.map((item, i) => {
            switch (item.type) {
              case 'collapsed-group':
                return (
                  <CollapsedAuthorGroup
                    key={`collapsed-${item.author}-${i}`}
                    group={item}
                    prUrl={pr.prUrl}
                    onReply={onReply}
                    onHide={onHide}
                    onReact={onReact}
                  />
                )
              case 'review':
                return (
                  <div key={`review-${item.review.id || i}`}>
                    <ReviewRow
                      review={item.review}
                      icon={getReviewIcon(item.review.state)}
                      prUrl={pr.prUrl}
                      showReReview={item.review.state === 'CHANGES_REQUESTED'}
                      isApproved={item.review.state === 'APPROVED'}
                      hasConflicts={pr.hasConflicts}
                      onReReview={onReReview}
                      onMerge={
                        item.review.state === 'APPROVED' ? onMerge : undefined
                      }
                      onReply={onReply}
                      onReact={onReact}
                      onMarkRead={
                        item.review.isUnread && item.review.id
                          ? () =>
                              markNotificationReadByItem(
                                pr.repo,
                                pr.prNumber,
                                undefined,
                                item.review.id,
                              )
                          : undefined
                      }
                    />
                    {item.threads.map((thread, ti) => (
                      <div
                        key={`thread-${thread.comments[0]?.id || ti}`}
                        className="ml-2 border-l border-sidebar-border pl-2"
                      >
                        <ReviewThreadGroup
                          thread={thread}
                          prUrl={pr.prUrl}
                          pr={pr}
                          onHide={onHide}
                          onReply={onReply}
                          onReact={onReact}
                        />
                      </div>
                    ))}
                  </div>
                )
              case 'comment':
                return (
                  <CommentItem
                    key={`comment-${item.comment.id || i}`}
                    comment={item.comment}
                    prUrl={pr.prUrl}
                    onHide={onHide}
                    onReply={onReply}
                    onReact={onReact}
                    onMarkRead={
                      item.comment.isUnread && item.comment.id
                        ? () =>
                            markNotificationReadByItem(
                              pr.repo,
                              pr.prNumber,
                              item.comment.id,
                            )
                        : undefined
                    }
                  />
                )
              case 'thread':
                return (
                  <ReviewThreadGroup
                    key={`standalone-${item.thread.comments[0]?.id || i}`}
                    thread={item.thread}
                    prUrl={pr.prUrl}
                    pr={pr}
                    onHide={onHide}
                    onReply={onReply}
                    onReact={onReact}
                  />
                )
              default:
                return null
            }
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleCount((v) => v + 10)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Show more ({groupedDiscussion.length - visibleCount} remaining)
            </button>
          )}
        </>
      )}
    </>
  )
}

export function PRStatusContent({
  pr,
  expanded: expandedProp,
  onToggle,
}: PRStatusContentProps) {
  const hasHeader = onToggle !== undefined
  const expanded = hasHeader ? (expandedProp ?? false) : true

  const { settings, updateSettings } = useSettings()
  const [hideAuthor, setHideAuthor] = useState<string | null>(null)
  const hiddenAuthorsSet = useMemo(() => {
    const set = new Set<string>()
    for (const entry of settings?.hide_gh_authors ?? []) {
      if (entry.repo === pr.repo) {
        set.add(entry.author)
      }
    }
    return set
  }, [settings?.hide_gh_authors, pr.repo])

  const silencedAuthorsSet = useMemo(() => {
    const set = new Set<string>()
    for (const entry of settings?.silence_gh_authors ?? []) {
      if (entry.repo === pr.repo) {
        set.add(entry.author)
      }
    }
    return set
  }, [settings?.silence_gh_authors, pr.repo])

  const collapsedAuthorsSet = useMemo(() => {
    const set = new Set<string>()
    for (const entry of settings?.collapse_gh_authors ?? []) {
      if (entry.repo === pr.repo) {
        set.add(entry.author)
      }
    }
    return set
  }, [settings?.collapse_gh_authors, pr.repo])

  const hasChecks = pr.checks.length > 0
  const hasDiscussion = useMemo(
    () =>
      pr.discussion.some((item) => {
        if (item.type === 'comment') {
          return !hiddenAuthorsSet.has(item.comment.author)
        }
        return true
      }),
    [pr.discussion, hiddenAuthorsSet],
  )

  const [owner, repo] = pr.repo.split('/')

  const [reReviewAuthor, setReReviewAuthor] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rerunCheck, setRerunCheck] = useState<{
    name: string
    url: string
  } | null>(null)
  const [rerunAllOpen, setRerunAllOpen] = useState(false)
  const [replyTarget, setReplyTarget] = useState<{
    author: string
    reviewCommentId?: number
  } | null>(null)

  const handleMerge = async (method: 'merge' | 'squash' | 'rebase') => {
    try {
      await api.mergePR(owner, repo, pr.prNumber, method)
      toast.success('PR merged successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge PR')
      throw err
    }
  }

  const handleReRequestReview = async () => {
    if (!reReviewAuthor) return
    try {
      await api.requestPRReview(owner, repo, pr.prNumber, reReviewAuthor)
      toast.success(`Review requested from ${reReviewAuthor}`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to request review',
      )
      throw err
    }
  }

  const handleReReview = useCallback(
    (author: string) => setReReviewAuthor(author),
    [],
  )

  const handleReply = useCallback(
    (author: string, reviewCommentId?: number) => {
      setReplyTarget({ author, reviewCommentId })
    },
    [],
  )

  const { reactToPR } = useTerminalContext()

  const handleReact = async (
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove?: boolean,
  ) => {
    try {
      await reactToPR(
        pr.repo,
        pr.prNumber,
        subjectId,
        subjectType,
        content,
        !!remove,
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update reaction',
      )
    }
  }

  const handleSendReply = async (body: string) => {
    try {
      if (replyTarget?.reviewCommentId) {
        await api.replyToReviewComment(
          owner,
          repo,
          pr.prNumber,
          replyTarget.reviewCommentId,
          body,
        )
      } else {
        await api.addPRComment(owner, repo, pr.prNumber, body)
      }
      toast.success('Comment posted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post comment')
      throw err
    }
  }

  const handleRerunCheck = async () => {
    if (!rerunCheck) return
    try {
      await api.rerunFailedCheck(owner, repo, pr.prNumber, rerunCheck.url)
      toast.success('Re-running failed jobs')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rerun check')
      throw err
    }
  }

  // Filter for completed failed checks (not in-progress or queued)
  const failedCompletedChecks = useMemo(
    () => pr.checks.filter((c) => c.status === 'COMPLETED'),
    [pr.checks],
  )

  const handleRerunAllChecks = async () => {
    if (failedCompletedChecks.length === 0) return
    const checkUrls = failedCompletedChecks.map((c) => c.detailsUrl)
    try {
      const result = await api.rerunAllFailedChecks(
        owner,
        repo,
        pr.prNumber,
        checkUrls,
      )
      toast.success(`Re-running ${result.rerunCount} failed workflow(s)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rerun checks')
      throw err
    }
  }

  const handleHideComment = useCallback(
    (author: string) => setHideAuthor(author),
    [],
  )

  const handleAuthorConfig = async (config: {
    hideComments: boolean
    silenceNotifications: boolean
    collapseReplies: boolean
  }) => {
    if (!hideAuthor) return

    const currentHidden = settings?.hide_gh_authors ?? []
    const currentSilenced = settings?.silence_gh_authors ?? []
    const currentCollapsed = settings?.collapse_gh_authors ?? []

    const withoutHidden = currentHidden.filter(
      (e) => !(e.repo === pr.repo && e.author === hideAuthor),
    )
    const withoutSilenced = currentSilenced.filter(
      (e) => !(e.repo === pr.repo && e.author === hideAuthor),
    )
    const withoutCollapsed = currentCollapsed.filter(
      (e) => !(e.repo === pr.repo && e.author === hideAuthor),
    )

    const newHidden = config.hideComments
      ? [...withoutHidden, { repo: pr.repo, author: hideAuthor }]
      : withoutHidden
    const newSilenced = config.silenceNotifications
      ? [...withoutSilenced, { repo: pr.repo, author: hideAuthor }]
      : withoutSilenced
    const newCollapsed = config.collapseReplies
      ? [...withoutCollapsed, { repo: pr.repo, author: hideAuthor }]
      : withoutCollapsed

    try {
      await updateSettings({
        hide_gh_authors: newHidden,
        silence_gh_authors: newSilenced,
        collapse_gh_authors: newCollapsed,
      })

      if (config.hideComments) {
        toast.success(`Comments from ${hideAuthor} hidden`)
      } else if (config.collapseReplies) {
        toast.success(`Replies from ${hideAuthor} collapsed`)
      } else if (config.silenceNotifications) {
        toast.success(`Notifications from ${hideAuthor} silenced`)
      } else {
        toast.success(`Filters for ${hideAuthor} removed`)
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update settings',
      )
      throw err
    }
  }

  const hasBody = !!pr.prBody
  const [bodyModalOpen, setBodyModalOpen] = useState(false)

  const hasContent = hasBody || hasChecks || hasDiscussion

  // Header-only mode: if no content and no header, nothing to render
  if (!hasHeader && !hasContent) return null

  // Merged state with header: just show a merged tab
  if (hasHeader && pr.isMerged) {
    return <PRTabButton pr={pr} active />
  }

  return (
    <>
      {expanded && hasContent && (
        <div className="space-y-0.5">
          {/* PR Body */}
          {hasBody && (
            <div
              onClick={() => setBodyModalOpen(true)}
              className="px-2 py-1 text-xs text-sidebar-foreground/70 line-clamp-2 leading-[1.5] cursor-pointer hover:bg-sidebar-accent/30 rounded transition-colors"
            >
              <MarkdownContent content={pr.prBody} />
            </div>
          )}
          {hasBody && bodyModalOpen && (
            <ContentDialog
              author={
                <div className="flex items-center justify-between w-full">
                  <h2>{pr.prTitle}</h2>
                  <span>#{pr.prNumber}</span>
                </div>
              }
              content={pr.prBody}
              onClose={() => setBodyModalOpen(false)}
            />
          )}

          {/* Checks */}
          {hasChecks && (
            <div className="relative flex flex-col gap-0 pl-[13px]">
              <div className="absolute top-[5px] h-[calc(100%-12px)] border-l-[1px]" />
              {pr.checks.map((check) => (
                <div
                  key={check.name}
                  className="group/check flex items-center gap-2 px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors"
                >
                  <a
                    href={check.detailsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                  >
                    {check.status === 'IN_PROGRESS' ||
                    check.status === 'QUEUED' ? (
                      <Loader2 className="w-3 h-3 flex-shrink-0 text-yellow-500 animate-spin" />
                    ) : (
                      <CircleX className="w-3 h-3 flex-shrink-0 text-red-500" />
                    )}
                    <span className="text-xs truncate">{check.name}</span>
                    {check.startedAt && (
                      <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 ml-auto">
                        {formatTimeAgo(check.startedAt)}
                      </span>
                    )}
                  </a>
                  {check.status === 'COMPLETED' && (
                    <button
                      type="button"
                      onClick={() =>
                        setRerunCheck({
                          name: check.name,
                          url: check.detailsUrl,
                        })
                      }
                      className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/check:opacity-100 transition-opacity cursor-pointer"
                    >
                      <RefreshIcon className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}

              {failedCompletedChecks.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRerunAllOpen(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <RefreshIcon className="w-3 h-3" />
                  Re-run All ({failedCompletedChecks.length})
                </button>
              )}
            </div>
          )}

          {/* Discussion Timeline */}
          <DiscussionTimeline
            discussion={pr.discussion}
            pr={pr}
            hiddenAuthorsSet={hiddenAuthorsSet}
            collapsedAuthorsSet={collapsedAuthorsSet}
            onReReview={handleReReview}
            onMerge={() => setMergeOpen(true)}
            onReply={handleReply}
            onHide={handleHideComment}
            onReact={handleReact}
          />

          {reReviewAuthor && (
            <ReReviewDialog
              author={reReviewAuthor}
              onConfirm={handleReRequestReview}
              onClose={() => setReReviewAuthor(null)}
            />
          )}

          {mergeOpen && (
            <MergeDialog
              prNumber={pr.prNumber}
              onConfirm={handleMerge}
              onClose={() => setMergeOpen(false)}
            />
          )}

          {rerunCheck && (
            <RerunCheckDialog
              checkName={rerunCheck.name}
              onConfirm={handleRerunCheck}
              onClose={() => setRerunCheck(null)}
            />
          )}

          {rerunAllOpen && (
            <RerunAllChecksDialog
              checkCount={failedCompletedChecks.length}
              onConfirm={handleRerunAllChecks}
              onClose={() => setRerunAllOpen(false)}
            />
          )}

          {hideAuthor && (
            <HideAuthorDialog
              author={hideAuthor}
              repo={pr.repo}
              isHidden={hiddenAuthorsSet.has(hideAuthor)}
              isSilenced={silencedAuthorsSet.has(hideAuthor)}
              isCollapsed={collapsedAuthorsSet.has(hideAuthor)}
              onSave={handleAuthorConfig}
              onClose={() => setHideAuthor(null)}
            />
          )}

          {replyTarget && (
            <ReplyDialog
              author={replyTarget.author}
              onConfirm={handleSendReply}
              onClose={() => setReplyTarget(null)}
            />
          )}
        </div>
      )}
    </>
  )
}
