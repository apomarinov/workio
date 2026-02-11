import {
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock,
  File,
  Loader2,
  MessageSquare,
  Reply,
} from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '@/hooks/useSettings'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type {
  PRCheckStatus,
  PRDiscussionItem,
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
  onSeen?: () => void
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
}: {
  review: PRReview
  icon: React.ReactNode
  prUrl: string
  showReReview?: boolean
  isApproved?: boolean
  hasConflicts?: boolean
  onReReview: (author: string) => void
  onMerge?: () => void
  onReply: (author: string) => void
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

  const reviewUrl = review.url || prUrl

  return (
    <div className="group/review px-2 py-1 rounded text-sidebar-foreground/70">
      <div className="flex items-center gap-1.5">
        <a
          href={reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 min-w-0 py-1 flex-1 hover:bg-sidebar-accent/30 rounded transition-colors cursor-pointer"
        >
          {icon}
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
          onClick={() => setBodyOpen(true)}
          className="mt-1 text-xs line-clamp-3 cursor-pointer hover:bg-sidebar-accent/30 rounded p-1 transition-colors"
        >
          <MarkdownContent content={review.body} />
        </div>
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
  hidePath,
  indent,
}: {
  comment: {
    url?: string
    author: string
    avatarUrl: string
    body: string
    createdAt: string
    path?: string
  }
  prUrl: string
  onHide: (author: string) => void
  onReply: (author: string) => void
  hidePath?: boolean
  indent?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const handleHide = useCallback(
    () => onHide(comment.author),
    [onHide, comment.author],
  )

  const handleReply = useCallback(
    () => onReply(comment.author),
    [onReply, comment.author],
  )

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
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0 min-w-0 cursor-pointer"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
            )}
          </button>
          <a
            href={commentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 min-w-0 flex-1 hover:bg-sidebar-accent/30 rounded transition-colors cursor-pointer"
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
            className="text-muted-foreground/30 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity cursor-pointer"
          >
            <BellOff className="w-3 h-3" />
          </button>
        </div>
        <div
          onClick={() => setModalOpen(true)}
          className={cn(
            'mt-1 text-xs cursor-pointer hover:bg-sidebar-accent/30 rounded px-1 py-0.5 transition-colors',
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
  onHide,
  onReply,
}: {
  thread: PRReviewThread
  prUrl: string
  onHide: (author: string) => void
  onReply: (author: string) => void
}) {
  const [root, ...replies] = thread.comments
  if (!root) return null

  return (
    <div className="ml-2 border-l border-sidebar-border pl-2">
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
        onReply={onReply}
        hidePath
      />
      {replies.map((reply, i) => (
        <CommentItem
          key={reply.id || i}
          comment={reply}
          prUrl={prUrl}
          onHide={onHide}
          onReply={onReply}
          hidePath
          indent
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
}: {
  group: CollapsedGroup
  prUrl: string
  onReply: (author: string) => void
  onHide: (author: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
        )}
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
          />
        ))}
    </div>
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
}: {
  discussion: PRDiscussionItem[]
  pr: PRCheckStatus
  hiddenAuthorsSet: Set<string>
  collapsedAuthorsSet: Set<string>
  onReReview: (author: string) => void
  onMerge: () => void
  onReply: (author: string) => void
  onHide: (author: string) => void
}) {
  const [visibleCount, setVisibleCount] = useState(5)
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
      <div className="px-2 pb-1">
        <Select value={displayMode} onValueChange={handleDisplayModeChange}>
          <SelectTrigger
            size="sm"
            className="!h-5 ml-auto text-[10px] border-none shadow-none px-1.5 gap-1"
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
      </div>
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
                />
                {item.threads.map((thread, ti) => (
                  <ReviewThreadGroup
                    key={`thread-${thread.comments[0]?.id || ti}`}
                    thread={thread}
                    prUrl={pr.prUrl}
                    onHide={onHide}
                    onReply={onReply}
                  />
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
              />
            )
          case 'thread':
            return (
              <ReviewThreadGroup
                key={`standalone-${item.thread.comments[0]?.id || i}`}
                thread={item.thread}
                prUrl={pr.prUrl}
                onHide={onHide}
                onReply={onReply}
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
  )
}

export function PRStatusContent({
  pr,
  expanded: expandedProp,
  onToggle,
  onSeen,
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
  const [replyAuthor, setReplyAuthor] = useState<string | null>(null)

  const handleMerge = async (method: 'merge' | 'squash' | 'rebase') => {
    await api.mergePR(owner, repo, pr.prNumber, method)
    toast.success('PR merged successfully')
  }

  const handleReRequestReview = async () => {
    if (!reReviewAuthor) return
    await api.requestPRReview(owner, repo, pr.prNumber, reReviewAuthor)
    toast.success(`Review requested from ${reReviewAuthor}`)
  }

  const handleReReview = useCallback(
    (author: string) => setReReviewAuthor(author),
    [],
  )

  const handleReply = useCallback((author: string) => {
    setReplyAuthor(author)
  }, [])

  const handleSendReply = async (body: string) => {
    await api.addPRComment(owner, repo, pr.prNumber, body)
    toast.success('Comment posted')
  }

  const handleRerunCheck = async () => {
    if (!rerunCheck) return
    await api.rerunFailedCheck(owner, repo, pr.prNumber, rerunCheck.url)
    toast.success('Re-running failed jobs')
  }

  // Filter for completed failed checks (not in-progress or queued)
  const failedCompletedChecks = useMemo(
    () => pr.checks.filter((c) => c.status === 'COMPLETED'),
    [pr.checks],
  )

  const handleRerunAllChecks = async () => {
    if (failedCompletedChecks.length === 0) return
    const checkUrls = failedCompletedChecks.map((c) => c.detailsUrl)
    const result = await api.rerunAllFailedChecks(
      owner,
      repo,
      pr.prNumber,
      checkUrls,
    )
    toast.success(`Re-running ${result.rerunCount} failed workflow(s)`)
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
  }

  const hasBody = !!pr.prBody
  const [bodyModalOpen, setBodyModalOpen] = useState(false)

  const hasContent = hasBody || hasChecks || hasDiscussion

  // Header-only mode: if no content and no header, nothing to render
  if (!hasHeader && !hasContent) return null

  // Merged state with header: just show a merged tab
  if (hasHeader && pr.isMerged) {
    return <PRTabButton pr={pr} active onClick={onSeen} />
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

          {replyAuthor && (
            <ReplyDialog
              author={replyAuthor}
              onConfirm={handleSendReply}
              onClose={() => setReplyAuthor(null)}
            />
          )}
        </div>
      )}
    </>
  )
}
