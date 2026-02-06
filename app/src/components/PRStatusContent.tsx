import {
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock,
  ExternalLink,
  File,
  Loader2,
  MessageSquare,
  Reply,
} from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '@/hooks/useSettings'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type { PRCheckStatus, PRReview } from '../../shared/types'
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
    <div className="group/pr-btn flex items-center">
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
      <a
        href={pr.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="ml-1 mb-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer hidden group-hover/pr-btn:block"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
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

  const reviewUrl = review.id
    ? `${prUrl}#pullrequestreview-${review.id}`
    : prUrl

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
      <div className="group/comment px-2 py-1 rounded text-sidebar-foreground/70">
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
          {comment.path && (
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

  const approvedReviews = useMemo(
    () => pr.reviews.filter((r) => r.state === 'APPROVED'),
    [pr.reviews],
  )
  const changesRequestedReviews = useMemo(
    () => pr.reviews.filter((r) => r.state === 'CHANGES_REQUESTED'),
    [pr.reviews],
  )
  const pendingReviews = useMemo(
    () => pr.reviews.filter((r) => r.state === 'PENDING'),
    [pr.reviews],
  )
  const commentedReviews = useMemo(
    () => pr.reviews.filter((r) => r.state === 'COMMENTED'),
    [pr.reviews],
  )
  const hasReviews =
    approvedReviews.length > 0 ||
    changesRequestedReviews.length > 0 ||
    pendingReviews.length > 0 ||
    commentedReviews.length > 0
  const hasChecks = pr.checks.length > 0
  const hasComments = useMemo(
    () => pr.comments.some((c) => !hiddenAuthorsSet.has(c.author)),
    [pr.comments, hiddenAuthorsSet],
  )

  const [visibleCount, setVisibleCount] = useState(5)

  const [owner, repo] = pr.repo.split('/')
  const filteredComments = useMemo(
    () => pr.comments.filter((c) => !hiddenAuthorsSet.has(c.author)),
    [pr.comments, hiddenAuthorsSet],
  )
  const visibleComments = useMemo(
    () => filteredComments.slice(0, visibleCount),
    [filteredComments, visibleCount],
  )
  const hasMoreComments = visibleCount < filteredComments.length

  const handleShowMore = () => {
    setVisibleCount((v) => v + 10)
  }

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

  const handleHideAuthor = async () => {
    if (!hideAuthor) return
    const current = settings?.hide_gh_authors ?? []
    const alreadyHidden = current.some(
      (e) => e.repo === pr.repo && e.author === hideAuthor,
    )
    if (alreadyHidden) return
    await updateSettings({
      hide_gh_authors: [...current, { repo: pr.repo, author: hideAuthor }],
    })
    toast.success(`Comments from ${hideAuthor} hidden`)
  }

  const hasBody = !!pr.prBody
  const [bodyModalOpen, setBodyModalOpen] = useState(false)

  const hasContent = hasBody || hasReviews || hasChecks || hasComments

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

          {/* Reviews */}
          {approvedReviews.map((review) => (
            <ReviewRow
              key={`approved-${review.author}`}
              review={review}
              icon={<Check className="w-3 h-3 flex-shrink-0 text-green-500" />}
              prUrl={pr.prUrl}
              isApproved
              hasConflicts={pr.hasConflicts}
              onReReview={handleReReview}
              onMerge={() => setMergeOpen(true)}
              onReply={handleReply}
            />
          ))}
          {changesRequestedReviews.map((review) => (
            <ReviewRow
              key={`changes-${review.author}`}
              review={review}
              icon={
                <RefreshIcon className="w-3 h-3 flex-shrink-0 text-orange-400" />
              }
              prUrl={pr.prUrl}
              showReReview
              onReReview={handleReReview}
              onReply={handleReply}
            />
          ))}
          {pendingReviews.map((review) => (
            <ReviewRow
              key={`pending-${review.author}`}
              review={review}
              icon={<Clock className="w-3 h-3 flex-shrink-0 text-zinc-500" />}
              prUrl={pr.prUrl}
              onReReview={handleReReview}
              onReply={handleReply}
            />
          ))}
          {commentedReviews.map((review) => (
            <ReviewRow
              key={`commented-${review.author}`}
              review={review}
              icon={
                <MessageSquare className="w-3 h-3 flex-shrink-0 text-zinc-500" />
              }
              prUrl={pr.prUrl}
              onReReview={handleReReview}
              onReply={handleReply}
            />
          ))}

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

            {/* Comments */}
            {hasComments && (
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1">
                Comments
              </p>
            )}
            {visibleComments.map((comment, i) => (
              <CommentItem
                key={`${comment.author}-${i}`}
                comment={comment}
                prUrl={pr.prUrl}
                onHide={handleHideComment}
                onReply={handleReply}
              />
            ))}

            {hasComments && hasMoreComments && (
              <button
                type="button"
                onClick={handleShowMore}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Show more ({filteredComments.length - visibleCount} remaining)
              </button>
            )}
          </div>

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
              onConfirm={handleHideAuthor}
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
