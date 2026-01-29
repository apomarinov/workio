import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { PRCheckStatus, PRComment } from '../../shared/types'
import * as api from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

interface PRStatusContentProps {
  pr: PRCheckStatus
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

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {comment.avatarUrl && (
                <img
                  src={comment.avatarUrl}
                  alt={comment.author}
                  className="w-5 h-5 rounded-full"
                />
              )}
              {comment.author}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm">
            <MarkdownContent content={comment.body} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PRStatusContent({ pr }: PRStatusContentProps) {
  const approvedReviews = pr.reviews.filter((r) => r.state === 'APPROVED')
  const changesRequestedReviews = pr.reviews.filter(
    (r) => r.state === 'CHANGES_REQUESTED',
  )
  const hasReviews =
    approvedReviews.length > 0 || changesRequestedReviews.length > 0
  const hasChecks = pr.checks.length > 0
  const hasComments = pr.comments.length > 0

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

  if (!hasReviews && !hasChecks && !hasComments) return null

  return (
    <div className="space-y-0.5">
      {/* Reviews */}
      {approvedReviews.map((review) => (
        <a
          key={`approved-${review.author}`}
          href={pr.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-pointer"
        >
          <Check className="w-3 h-3 flex-shrink-0 text-green-500" />
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
      ))}
      {changesRequestedReviews.map((review) => (
        <a
          key={`changes-${review.author}`}
          href={pr.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3 h-3 flex-shrink-0 text-orange-500" />
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
      ))}

      <div className="relative flex flex-col gap-0 pl-3">
        <div className="absolute h-[calc(100%-5px)] border-l-[1px]"></div>
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
            {loadingMore ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {loadingMore ? 'Loading...' : 'Load more comments'}
          </button>
        )}
      </div>
    </div>
  )
}
