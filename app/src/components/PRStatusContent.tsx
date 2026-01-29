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
import type { PRCheckStatus } from '../../shared/types'
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
  const firstLine = comment.body.split('\n')[0] || ''

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
        {!expanded && (
          <p className="text-xs text-muted-foreground truncate ml-[34px]">
            {firstLine}
          </p>
        )}
        {expanded && (
          <div
            onClick={() => setModalOpen(true)}
            className="ml-[34px] mt-1 text-xs cursor-pointer hover:bg-sidebar-accent/30 rounded p-1 transition-colors"
          >
            <MarkdownContent content={comment.body} />
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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

      {/* Failed checks */}
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
      {pr.comments.map((comment, i) => (
        <CommentItem key={`${comment.author}-${i}`} comment={comment} />
      ))}
    </div>
  )
}
