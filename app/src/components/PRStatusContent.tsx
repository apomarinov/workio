import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock,
  GitMerge,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
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
import { cn } from '@/lib/utils'
import type { PRCheckStatus, PRComment, PRReview } from '../../shared/types'
import * as api from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

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

function ReviewRow({
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
  onReReview: () => void
}) {
  const [bodyOpen, setBodyOpen] = useState(false)

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
            onClick={onReReview}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/review:opacity-100 transition-opacity cursor-pointer"
          >
            Re-review
          </button>
        )}
      </div>
      {review.body && (
        <div
          onClick={() => setBodyOpen(true)}
          className="ml-[18px] mt-1 text-xs line-clamp-3 cursor-pointer hover:bg-sidebar-accent/30 rounded p-1 transition-colors"
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
}

function CommentItem({
  comment,
}: {
  comment: {
    author: string
    avatarUrl: string
    body: string
    createdAt: string
  }
}) {
  const [expanded, setExpanded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div className="px-2 py-1 rounded text-sidebar-foreground/70">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full cursor-pointer"
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
          <span className="text-xs font-medium truncate">{comment.author}</span>
        </button>
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
}

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

  const approvedReviews = pr.reviews.filter((r) => r.state === 'APPROVED')
  const changesRequestedReviews = pr.reviews.filter(
    (r) => r.state === 'CHANGES_REQUESTED',
  )
  const pendingReviews = pr.reviews.filter((r) => r.state === 'PENDING')
  const hasReviews =
    approvedReviews.length > 0 ||
    changesRequestedReviews.length > 0 ||
    pendingReviews.length > 0
  const hasChecks = pr.checks.length > 0
  const hasComments = pr.comments.length > 0
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

  const [extraComments, setExtraComments] = useState<PRComment[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const [owner, repo] = pr.repo.split('/')
  const allComments = [...pr.comments, ...extraComments]

  const handleLoadMore = async () => {
    setLoadingMore(true)
    try {
      const result = await api.getPRComments(
        owner,
        repo,
        pr.prNumber,
        20,
        allComments.length,
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

  const hasContent = hasReviews || hasChecks || hasComments

  // Header-only mode: if no content and no header, nothing to render
  if (!hasHeader && !hasContent) return null

  // Merged state with header: just show a merged link
  if (hasHeader && isMerged) {
    return (
      <a
        href={pr.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 pt-1 text-purple-400/70 hover:text-purple-400 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <GitMerge className="w-3 h-3" />
        Merged
      </a>
    )
  }

  const renderHeader = () => {
    if (!hasHeader) return null

    const isApproved = pr.reviewDecision === 'APPROVED'
    const hasChangesRequested = pr.reviewDecision === 'CHANGES_REQUESTED'

    return (
      <div className="group/header flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            onToggle()
            onSeen?.()
          }}
          className={cn(
            'group/gh flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider px-2 pt-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors',
            hasChangesRequested
              ? 'text-orange-400/70 hover:text-orange-400'
              : isApproved
                ? 'text-green-500/70 hover:text-green-500'
                : hasRunningChecks
                  ? 'text-yellow-400/70 hover:text-yellow-400'
                  : hasFailedChecks
                    ? 'text-red-400/70 hover:text-red-400'
                    : '',
          )}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <>
              {(hasChangesRequested || isApproved || hasChecks || pendingReviews.length > 0) && (
                <ChevronRight className="w-3 h-3 hidden group-hover/gh:block" />
              )}
              {hasChangesRequested ? (
                <RefreshCw className="w-3 h-3 text-orange-400/70 group-hover/gh:hidden" />
              ) : hasRunningChecks ? (
                <Loader2 className="w-3 h-3 text-yellow-500/70 animate-spin group-hover/gh:hidden" />
              ) : isApproved ? (
                <Check className="w-3 h-3 text-green-500/70 group-hover/gh:hidden" />
              ) : hasFailedChecks ? (
                <CircleX className="w-3 h-3 text-red-500/70 group-hover/gh:hidden" />
              ) : pendingReviews.length > 0 ? (
                <Clock className="w-3 h-3 opacity-80 group-hover/gh:hidden" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </>
          )}
          {hasChangesRequested
            ? 'Change request'
            : hasRunningChecks
              ? 'Pull request'
              : isApproved
                ? 'approved'
                : hasFailedChecks
                  ? 'failed checks'
                  : 'Pull Request'}
          {hasNewActivity && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 ml-auto" />
          )}
        </button>
        {isApproved && (
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity cursor-pointer pr-2 pt-1"
          >
            Merge
          </button>
        )}
      </div>
    )
  }

  const renderReviewRow = (
    review: (typeof pr.reviews)[number],
    icon: React.ReactNode,
    keyPrefix: string,
    showReReview?: boolean,
  ) => (
    <ReviewRow
      key={`${keyPrefix}-${review.author}`}
      review={review}
      icon={icon}
      prUrl={pr.prUrl}
      showReReview={showReReview}
      onReReview={() => setReReviewAuthor(review.author)}
    />
  )

  return (
    <>
      {renderHeader()}
      {expanded && hasContent && (
        <div className="space-y-0.5">
          {/* Reviews */}
          {approvedReviews.map((review) =>
            renderReviewRow(
              review,
              <Check className="w-3 h-3 flex-shrink-0 text-green-500" />,
              'approved',
            ),
          )}
          {changesRequestedReviews.map((review) =>
            renderReviewRow(
              review,
              <RefreshCw className="w-3 h-3 flex-shrink-0 text-orange-400" />,
              'changes',
              true,
            ),
          )}
          {pendingReviews.map((review) =>
            renderReviewRow(
              review,
              <Clock className="w-3 h-3 flex-shrink-0 text-zinc-500" />,
              'pending',
            ),
          )}

          <div className="relative flex flex-col gap-0 pl-3">
            <div className="absolute h-[calc(100%-5px)] border-l-[1px]" />
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
              <CommentItem key={`${comment.author}-${i}`} comment={comment} />
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
        </div>
      )}
    </>
  )
}
