import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import type { PRCheckStatus, PRComment, PRReview } from '../../shared/types'
import * as api from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

export function getPRStatusInfo(pr?: PRCheckStatus) {
  if (!pr) {
    return {
      label: '',
      colorClass: 'hidden',
      dimColorClass: '',
    }
  }

  const isMerged = pr.state === 'MERGED'
  const isApproved = pr.reviewDecision === 'APPROVED'
  const hasChangesRequested = pr.reviewDecision === 'CHANGES_REQUESTED'
  const hasRunningChecks = pr.checks.some(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED',
  )
  const hasFailedChecks = pr.checks.some(
    (c) =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== 'NEUTRAL',
  )
  const hasConflicts = pr.mergeable === 'CONFLICTING'

  if (isMerged)
    return {
      label: 'Merged',
      colorClass: 'text-purple-400',
      dimColorClass: 'text-purple-400/70 hover:text-purple-400',
    }
  if (hasChangesRequested)
    return {
      label: 'Change request',
      colorClass: 'text-orange-400',
      dimColorClass: 'text-orange-400/70 hover:text-orange-400',
    }
  if (hasRunningChecks)
    return {
      label: 'Running checks',
      colorClass: 'text-yellow-400',
      dimColorClass: 'text-yellow-400/70 hover:text-yellow-400',
    }
  if (hasFailedChecks)
    return {
      label: 'Failed checks',
      colorClass: 'text-red-400',
      dimColorClass: 'text-red-400/70 hover:text-red-400',
    }
  if (isApproved && hasConflicts)
    return {
      label: 'Conflicts',
      colorClass: 'text-red-400',
      dimColorClass: 'text-red-400/70 hover:text-red-400',
    }
  if (isApproved)
    return {
      label: 'Approved',
      colorClass: 'text-green-500',
      dimColorClass: 'text-green-500/70 hover:text-green-500',
    }
  if (pr.areAllChecksOk)
    return {
      label: 'Checks passed',
      colorClass: '',
      dimColorClass: '',
    }
  return { label: 'Pull Request', colorClass: '', dimColorClass: '' }
}

export const PRTabButton = memo(function PRTabButton({
  pr,
  active = false,
  hasNewActivity,
  onClick,
  className,
}: {
  pr: PRCheckStatus
  active?: boolean
  hasNewActivity?: boolean
  className?: string
  onClick?: () => void
}) {
  const { label, colorClass, dimColorClass } = useMemo(
    () => getPRStatusInfo(pr),
    [pr],
  )

  return (
    <div className="group/pr-btn flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors cursor-pointer',
          active
            ? cn(colorClass || 'text-foreground', 'bg-sidebar-accent')
            : cn(
              dimColorClass ||
              'text-muted-foreground/60 hover:text-muted-foreground',
            ),
          className,
        )}
      >
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
        className="ml-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors invisible group-hover/pr-btn:visible"
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

function ContentDialog({
  author,
  avatarUrl,
  content,
  open,
  onOpenChange,
}: {
  author: string
  avatarUrl?: string
  content: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt={author}
                className="w-5 h-5 rounded-full"
              />
            )}
            {author}
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm">
          <MarkdownContent content={content} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

const ReviewRow = memo(function ReviewRow({
  review,
  icon,
  prUrl,
  showReReview,
  onReReview,
}: {
  review: PRReview
  icon: React.ReactNode
  prUrl: string
  showReReview?: boolean
  onReReview: (author: string) => void
}) {
  const [bodyOpen, setBodyOpen] = useState(false)

  const handleReReview = useCallback(
    () => onReReview(review.author),
    [onReReview, review.author],
  )

  return (
    <div className="group/review px-2 py-1 rounded text-sidebar-foreground/70">
      <div className="flex items-center gap-1.5">
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 min-w-0 flex-1 hover:bg-sidebar-accent/30 rounded transition-colors cursor-pointer"
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
        {showReReview && (
          <button
            type="button"
            onClick={handleReReview}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/review:opacity-100 transition-opacity cursor-pointer"
          >
            Re-review
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
      {review.body && (
        <ContentDialog
          author={review.author}
          avatarUrl={review.avatarUrl}
          content={review.body}
          open={bodyOpen}
          onOpenChange={setBodyOpen}
        />
      )}
    </div>
  )
})

const CommentItem = memo(function CommentItem({
  comment,
  onHide,
}: {
  comment: {
    author: string
    avatarUrl: string
    body: string
    createdAt: string
  }
  onHide: (author: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const handleHide = useCallback(
    () => onHide(comment.author),
    [onHide, comment.author],
  )

  return (
    <>
      <div className="group/comment px-2 py-1 rounded text-sidebar-foreground/70">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
            )}
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
          </button>
          <button
            type="button"
            onClick={handleHide}
            className="text-muted-foreground/30 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <div
          onClick={() => setModalOpen(true)}
          className={cn(
            ' mt-1 text-xs cursor-pointer hover:bg-sidebar-accent/30 rounded p-1 transition-colors',
            !expanded && 'line-clamp-1',
          )}
        >
          <MarkdownContent content={comment.body} />
        </div>
      </div>

      <ContentDialog
        author={comment.author}
        avatarUrl={comment.avatarUrl}
        content={comment.body}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  )
})

export function PRStatusContent({
  pr,
  expanded: expandedProp,
  onToggle,
  hasNewActivity,
  onSeen,
}: PRStatusContentProps) {
  const isMerged = pr.state === 'MERGED'
  const hasHeader = onToggle !== undefined
  const expanded = hasHeader ? (expandedProp ?? false) : true

  const [hiddenAuthors, setHiddenAuthors] = useLocalStorage<string[]>(
    'hidden-comment-authors',
    [],
  )
  const [hideAuthor, setHideAuthor] = useState<string | null>(null)
  const hiddenAuthorsSet = useMemo(
    () => new Set(hiddenAuthors),
    [hiddenAuthors],
  )

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
  const hasReviews =
    approvedReviews.length > 0 ||
    changesRequestedReviews.length > 0 ||
    pendingReviews.length > 0
  const hasChecks = pr.checks.length > 0
  const hasComments = useMemo(
    () => pr.comments.some((c) => !hiddenAuthorsSet.has(c.author)),
    [pr.comments, hiddenAuthorsSet],
  )
  const hasConflicts = pr.mergeable === 'CONFLICTING'

  const [extraComments, setExtraComments] = useState<PRComment[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const [owner, repo] = pr.repo.split('/')
  const allComments = useMemo(
    () =>
      [...pr.comments, ...extraComments].filter(
        (c) => !hiddenAuthorsSet.has(c.author),
      ),
    [pr.comments, extraComments, hiddenAuthorsSet],
  )

  const handleLoadMore = async () => {
    setLoadingMore(true)
    try {
      const result = await api.getPRComments(
        owner,
        repo,
        pr.prNumber,
        20,
        allComments.length,
        hiddenAuthors.length > 0 ? hiddenAuthors : undefined,
      )
      setExtraComments((prev) => [...prev, ...result.comments])
      setHasMore(allComments.length + result.comments.length < result.total)
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }

  const [reReviewAuthor, setReReviewAuthor] = useState<string | null>(null)
  const [reReviewLoading, setReReviewLoading] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>(
    'squash',
  )
  const [mergeLoading, setMergeLoading] = useState(false)

  const handleMerge = async () => {
    setMergeLoading(true)
    try {
      await api.mergePR(owner, repo, pr.prNumber, mergeMethod)
      toast.success('PR merged successfully')
      setMergeOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge PR')
    } finally {
      setMergeLoading(false)
    }
  }

  const handleReRequestReview = async () => {
    if (!reReviewAuthor) return
    setReReviewLoading(true)
    try {
      await api.requestPRReview(owner, repo, pr.prNumber, reReviewAuthor)
      toast.success(`Review requested from ${reReviewAuthor}`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to request review',
      )
    } finally {
      setReReviewLoading(false)
      setReReviewAuthor(null)
    }
  }

  const handleReReview = useCallback(
    (author: string) => setReReviewAuthor(author),
    [],
  )

  const handleHideComment = useCallback(
    (author: string) => setHideAuthor(author),
    [],
  )

  const hasContent = hasReviews || hasChecks || hasComments

  // Header-only mode: if no content and no header, nothing to render
  if (!hasHeader && !hasContent) return null

  // Merged state with header: just show a merged tab
  if (hasHeader && isMerged) {
    return <PRTabButton pr={pr} active onClick={onSeen} />
  }

  const renderHeader = () => {
    if (!hasHeader) return null

    const isApproved = pr.reviewDecision === 'APPROVED'

    return (
      <div className="group/header flex items-center justify-between">
        <PRTabButton
          pr={pr}
          active={expanded}
          hasNewActivity={hasNewActivity}
          onClick={() => {
            onToggle()
            onSeen?.()
          }}
        />
        {isApproved && (
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            disabled={hasConflicts}
            className={cn(
              'text-[10px] flex-shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity pr-2 pt-1',
              hasConflicts
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : 'text-muted-foreground/50 hover:text-muted-foreground cursor-pointer',
            )}
            title={hasConflicts ? 'Cannot merge: PR has conflicts' : undefined}
          >
            Merge
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {renderHeader()}
      {expanded && hasContent && (
        <div className="space-y-0.5">
          {/* Reviews */}
          {approvedReviews.map((review) => (
            <ReviewRow
              key={`approved-${review.author}`}
              review={review}
              icon={<Check className="w-3 h-3 flex-shrink-0 text-green-500" />}
              prUrl={pr.prUrl}
              onReReview={handleReReview}
            />
          ))}
          {changesRequestedReviews.map((review) => (
            <ReviewRow
              key={`changes-${review.author}`}
              review={review}
              icon={
                <RefreshCw className="w-3 h-3 flex-shrink-0 text-orange-400" />
              }
              prUrl={pr.prUrl}
              showReReview
              onReReview={handleReReview}
            />
          ))}
          {pendingReviews.map((review) => (
            <ReviewRow
              key={`pending-${review.author}`}
              review={review}
              icon={<Clock className="w-3 h-3 flex-shrink-0 text-zinc-500" />}
              prUrl={pr.prUrl}
              onReReview={handleReReview}
            />
          ))}

          <div className="relative flex flex-col gap-0 pl-[13px]">
            <div className="absolute top-[5px] h-[calc(100%-12px)] border-l-[1px]" />
            {/* Checks */}
            {hasChecks && (
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1">
                Checks ({pr.checks.length})
              </p>
            )}
            {pr.checks.map((check) => (
              <a
                key={check.name}
                href={check.detailsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-pointer"
              >
                {check.status === 'IN_PROGRESS' || check.status === 'QUEUED' ? (
                  <Loader2 className="w-3 h-3 flex-shrink-0 text-yellow-500 animate-spin" />
                ) : (
                  <CircleX className="w-3 h-3 flex-shrink-0 text-red-500" />
                )}
                <span className="text-xs truncate">{check.name}</span>
              </a>
            ))}

            {/* Comments */}
            {hasComments && (
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1">
                Comments
              </p>
            )}
            {allComments.map((comment, i) => (
              <CommentItem
                key={`${comment.author}-${i}`}
                comment={comment}
                onHide={handleHideComment}
              />
            ))}

            {hasComments && hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : null}
                {loadingMore ? 'Loading...' : 'Load more comments'}
              </button>
            )}
          </div>

          <Dialog
            open={reReviewAuthor !== null}
            onOpenChange={(open) => {
              if (!open) setReReviewAuthor(null)
            }}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Request re-review</DialogTitle>
                <DialogDescription>
                  Ask <span className="font-medium">{reReviewAuthor}</span> to
                  review this PR again?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setReReviewAuthor(null)}
                  disabled={reReviewLoading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReRequestReview}
                  disabled={reReviewLoading}
                >
                  {reReviewLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Request review'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Merge pull request</DialogTitle>
                <DialogDescription>
                  Merge <span className="font-medium">#{pr.prNumber}</span> into
                  the base branch?
                </DialogDescription>
              </DialogHeader>
              <Select
                value={mergeMethod}
                onValueChange={(v) =>
                  setMergeMethod(v as 'merge' | 'squash' | 'rebase')
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="squash">Squash and merge</SelectItem>
                  <SelectItem value="merge">Create a merge commit</SelectItem>
                  <SelectItem value="rebase">Rebase and merge</SelectItem>
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setMergeOpen(false)}
                  disabled={mergeLoading}
                >
                  Cancel
                </Button>
                <Button onClick={handleMerge} disabled={mergeLoading}>
                  {mergeLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Merge'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={hideAuthor !== null}
            onOpenChange={(open) => {
              if (!open) setHideAuthor(null)
            }}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Hide comments</DialogTitle>
                <DialogDescription>
                  Hide all comments from{' '}
                  <span className="font-medium">{hideAuthor}</span>?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setHideAuthor(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (hideAuthor) {
                      setHiddenAuthors((prev) =>
                        prev.includes(hideAuthor)
                          ? prev
                          : [...prev, hideAuthor],
                      )
                    }
                    setHideAuthor(null)
                  }}
                >
                  Hide
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  )
}
