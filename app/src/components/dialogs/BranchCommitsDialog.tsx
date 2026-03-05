import { GitCommitHorizontal, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { getBranchCommits, type PRCommit } from '@/lib/api'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { DiffViewerPanel } from '../DiffViewerPanel'

interface BranchCommitsDialogProps {
  open: boolean
  terminalId: number
  branch: string
  onClose: () => void
}

export function BranchCommitsDialog({
  open,
  terminalId,
  branch,
  onClose,
}: BranchCommitsDialogProps) {
  const [commits, setCommits] = useState<PRCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)

  // Load initial commits when dialog opens
  useEffect(() => {
    if (!open) return
    setCommits([])
    setHasMore(false)
    setSelectedCommit(null)
    offsetRef.current = 0
    setLoading(true)
    getBranchCommits(terminalId, branch, 20, 0)
      .then((data) => {
        setCommits(data.commits)
        setHasMore(data.hasMore)
        offsetRef.current = data.commits.length
        if (data.commits.length > 0) {
          setSelectedCommit(data.commits[0].hash)
        }
      })
      .catch(() => toast.error('Failed to load commits'))
      .finally(() => setLoading(false))
  }, [open, terminalId, branch])

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!open) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          setLoadingMore(true)
          getBranchCommits(terminalId, branch, 20, offsetRef.current)
            .then((data) => {
              setCommits((prev) => [...prev, ...data.commits])
              setHasMore(data.hasMore)
              offsetRef.current += data.commits.length
            })
            .catch(() => toast.error('Failed to load commits'))
            .finally(() => setLoadingMore(false))
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [open, hasMore, loadingMore, loading, terminalId, branch])

  const diffBase = selectedCommit
    ? `${selectedCommit}^..${selectedCommit}`
    : undefined

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[95vw] p-4 sm:max-w-[1500px] h-[95vh] max-h-[1500px] flex flex-col overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{branch}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex gap-0 overflow-hidden rounded-md border border-zinc-700">
          {/* Left column: commit list */}
          <div className="w-[220px] flex-shrink-0 border-r border-zinc-700 flex flex-col overflow-hidden">
            <div className="px-2 py-1.5 border-b border-zinc-700">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">
                Commits ({commits.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
              {loading ? (
                <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : commits.length === 0 ? (
                <div className="py-4 text-center text-sm text-zinc-500">
                  No commits
                </div>
              ) : (
                <>
                  {commits.map((commit) => (
                    <div
                      key={commit.hash}
                      className={cn(
                        'flex items-start gap-2 px-2 py-2 text-xs cursor-pointer hover:bg-zinc-800/50',
                        selectedCommit === commit.hash && 'bg-zinc-700/50',
                      )}
                      onClick={() =>
                        setSelectedCommit(
                          selectedCommit === commit.hash ? null : commit.hash,
                        )
                      }
                    >
                      <GitCommitHorizontal
                        className={cn(
                          'h-3.5 w-3.5 mt-0.5 flex-shrink-0',
                          selectedCommit === commit.hash
                            ? 'text-blue-400'
                            : 'text-zinc-500',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-zinc-300">{commit.message}</div>
                        <div className="text-zinc-500 font-mono">
                          {commit.hash.slice(0, 7)}
                        </div>
                        <div className="text-zinc-500">
                          {formatDate(commit.date)} · {commit.author}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={sentinelRef} className="h-1" />
                  {loadingMore && (
                    <div className="flex items-center justify-center py-3 text-sm text-zinc-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading more...
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right: diff viewer panel */}
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
            {diffBase ? (
              <DiffViewerPanel
                integrated
                terminalId={terminalId}
                base={diffBase}
                readOnly
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-zinc-500">
                Select a commit to view changes
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
