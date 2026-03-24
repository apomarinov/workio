import type { Commit } from '@domains/git/schema'
import { GitCommitHorizontal, Loader2, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { dropCommit, getBranchCommits, undoCommit } from '@/lib/api'
import { formatDate } from '@/lib/time'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { ConfirmModal } from './ConfirmModal'
import { DiffViewerPanel } from './DiffViewerPanel'
import { MobileSlidePanel } from './MobileSlidePanel'

function simpleHash(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

type BranchDiffPanelProps =
  | {
      terminalId: number
      baseBranch: string
      headBranch: string
      branch?: undefined
      /** Extra suffix for the commits SWR cache key (e.g. headCommitSha) */
      cacheKey?: string
      onNoRemote?: () => void
    }
  | {
      terminalId: number
      branch: string
      baseBranch?: undefined
      headBranch?: undefined
      cacheKey?: undefined
      onNoRemote?: undefined
    }

export function BranchDiffPanel(props: BranchDiffPanelProps) {
  const { terminalId } = props
  const isBranchMode = props.branch != null
  const isMobile = useIsMobile()

  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [mobileCommitsOpen, setMobileCommitsOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'undo' | 'drop'
    hash: string
    message: string
  } | null>(null)

  // ── Mode A: tRPC query for base..head comparison ──
  const { data: compareData, isLoading: loadingCompare } =
    trpc.git.diff.commits.useQuery(
      {
        terminalId,
        base: props.baseBranch!,
        head: props.headBranch!,
      },
      { enabled: !isBranchMode },
    )

  // ── Mode B: paginated fetch for single branch ──
  const [branchCommits, setBranchCommits] = useState<Commit[]>([])
  const [mergeBase, setMergeBase] = useState<string | undefined>()
  const [mergeBaseBranch, setMergeBaseBranch] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loadingBranch, setLoadingBranch] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)

  // Refresh branch commits (reusable after mutations)
  function refreshBranchCommits() {
    if (!isBranchMode) return
    setBranchCommits([])
    setMergeBase(undefined)
    setMergeBaseBranch(undefined)
    setHasMore(false)
    setSelectedCommit(null)
    offsetRef.current = 0
    setLoadingBranch(true)
    getBranchCommits(terminalId, props.branch, 20, 0)
      .then((data) => {
        setBranchCommits(data.commits)
        setHasMore(data.hasMore)
        setMergeBase(data.mergeBase)
        setMergeBaseBranch(data.mergeBaseBranch)
        offsetRef.current = data.commits.length
        if (data.commits.length > 0) {
          setSelectedCommit(data.commits[0].hash)
        }
      })
      .catch(() => toast.error('Failed to load commits'))
      .finally(() => setLoadingBranch(false))
  }

  // Initial fetch for branch mode
  useEffect(() => {
    refreshBranchCommits()
  }, [isBranchMode, terminalId, props.branch])

  // Intersection observer for infinite scroll (branch mode)
  useEffect(() => {
    if (!isBranchMode) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          !loadingMore &&
          !loadingBranch
        ) {
          setLoadingMore(true)
          getBranchCommits(terminalId, props.branch, 20, offsetRef.current)
            .then((data) => {
              setBranchCommits((prev) => [...prev, ...data.commits])
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
  }, [
    isBranchMode,
    hasMore,
    loadingMore,
    loadingBranch,
    terminalId,
    props.branch,
  ])

  // Notify parent when noRemote is detected (compare mode only)
  useEffect(() => {
    if (!isBranchMode && compareData?.noRemote) props.onNoRemote?.()
  }, [isBranchMode, compareData?.noRemote])

  // Reset selected commit when branches change (compare mode only)
  useEffect(() => {
    if (!isBranchMode) setSelectedCommit(null)
  }, [isBranchMode, props.baseBranch, props.headBranch])

  // ── Resolve commits and loading state ──
  const commits = isBranchMode ? branchCommits : (compareData?.commits ?? [])
  const loading = isBranchMode ? loadingBranch : loadingCompare

  // Compute a cache key from commit hashes for the file list
  const commitsCacheKey =
    commits.length > 0
      ? simpleHash(commits.map((c) => c.hash).join(','))
      : undefined

  // ── Diff base ──
  const diffBase = selectedCommit
    ? `${selectedCommit}^..${selectedCommit}`
    : isBranchMode
      ? undefined
      : `origin/${props.baseBranch}...origin/${props.headBranch}`

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'branch-diff-layout',
    storage: localStorage,
  })

  // ── Commit list content (shared between desktop panel and mobile slide panel) ──
  function renderCommitList() {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </div>
      )
    }
    if (commits.length === 0) {
      return (
        <div className="py-4 text-center text-sm text-zinc-500">No commits</div>
      )
    }
    // Find the index of the merge-base commit to know which commits are local
    const mergeBaseIndex = mergeBase
      ? commits.findIndex((c) => c.hash === mergeBase)
      : -1
    return (
      <>
        {commits.map((commit, index) => {
          const isMergeBaseCommit = mergeBase && commit.hash === mergeBase
          // Commits above merge-base are local (editable)
          const isAboveMergeBase =
            isBranchMode && mergeBaseIndex > 0 && index < mergeBaseIndex
          return (
            <div key={commit.hash} className="group">
              {isMergeBaseCommit && (
                <div className="flex items-center gap-2 px-2 py-1">
                  <div className="flex-1 border-t border-zinc-600" />
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0">
                    {mergeBaseBranch}
                  </span>
                  <div className="flex-1 border-t border-zinc-600" />
                </div>
              )}
              <div
                className={cn(
                  'flex items-start gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-zinc-800/50',
                  selectedCommit === commit.hash && 'bg-zinc-700/50',
                )}
                onClick={() => {
                  setSelectedCommit(
                    selectedCommit === commit.hash ? null : commit.hash,
                  )
                  if (isMobile) setMobileCommitsOpen(false)
                }}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      selectedCommit === commit.hash
                        ? 'text-blue-400'
                        : 'text-zinc-300',
                    )}
                  >
                    {commit.message}
                  </div>
                  <div className="text-zinc-500 font-mono">
                    {commit.hash.slice(0, 7)}
                  </div>
                  <div className="text-zinc-500">
                    {formatDate(commit.date)} · {commit.author}
                  </div>
                </div>
                {isAboveMergeBase && (
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 pt-0.5">
                    {index === 0 && (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-orange-400"
                        title="Undo commit (soft reset)"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmAction({
                            type: 'undo',
                            hash: commit.hash,
                            message: commit.message,
                          })
                        }}
                      >
                        <Undo2 className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400"
                      title="Drop commit"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmAction({
                          type: 'drop',
                          hash: commit.hash,
                          message: commit.message,
                        })
                      }}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {isBranchMode && (
          <>
            <div ref={sentinelRef} className="h-1" />
            {loadingMore && (
              <div className="flex items-center justify-center py-3 text-sm text-zinc-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading more...
              </div>
            )}
          </>
        )}
      </>
    )
  }

  // ── Mobile button label ──
  const selectedCommitObj = selectedCommit
    ? commits.find((c) => c.hash === selectedCommit)
    : null
  const commitButtonLabel = selectedCommitObj
    ? `${selectedCommitObj.hash.slice(0, 7)} ${selectedCommitObj.message.length > 30 ? `${selectedCommitObj.message.slice(0, 30)}...` : selectedCommitObj.message}`
    : `All changes (${commits.length} commits)`

  // ── Confirm modal handler ──
  async function handleConfirmAction() {
    if (!confirmAction) return
    try {
      if (confirmAction.type === 'undo') {
        await undoCommit(terminalId, confirmAction.hash)
        toast.success('Commit undone — changes are staged')
      } else {
        await dropCommit(terminalId, confirmAction.hash)
        toast.success('Commit dropped')
      }
      setConfirmAction(null)
      refreshBranchCommits()
    } catch (err) {
      toastError(err, 'Failed to modify commit')
    }
  }

  const confirmModal = (
    <ConfirmModal
      open={confirmAction != null}
      title={confirmAction?.type === 'undo' ? 'Undo commit?' : 'Drop commit?'}
      message={
        confirmAction?.type === 'undo'
          ? `This will soft-reset the last commit. Changes will remain staged.\n\n${confirmAction.hash.slice(0, 7)} ${confirmAction.message}`
          : `This will permanently remove this commit via rebase.\n\n${confirmAction?.hash.slice(0, 7)} ${confirmAction?.message}`
      }
      confirmLabel={confirmAction?.type === 'undo' ? 'Undo' : 'Drop'}
      variant="danger"
      onConfirm={handleConfirmAction}
      onCancel={() => setConfirmAction(null)}
    />
  )

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden gap-2">
        {/* Commits button */}
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2 text-xs font-mono shrink-0 overflow-hidden"
          onClick={() => setMobileCommitsOpen(true)}
        >
          <GitCommitHorizontal className="size-3 shrink-0" />
          <span className="truncate">{commitButtonLabel}</span>
        </Button>
        {/* DiffViewerPanel (integrated, handles its own files button on mobile) */}
        {diffBase ? (
          <DiffViewerPanel
            integrated
            terminalId={terminalId}
            base={diffBase}
            readOnly
            cacheKey={commitsCacheKey}
          />
        ) : (
          <div className="flex items-center justify-center flex-1 text-sm text-zinc-500">
            Select a commit to view changes
          </div>
        )}
        {/* Commits slide panel */}
        <MobileSlidePanel
          open={mobileCommitsOpen}
          onClose={() => setMobileCommitsOpen(false)}
          title={`Commits (${commits.length})`}
        >
          <div
            ref={isBranchMode ? scrollRef : undefined}
            className="h-full overflow-y-auto"
          >
            {renderCommitList()}
          </div>
        </MobileSlidePanel>
        {confirmModal}
      </div>
    )
  }

  return (
    <>
      <Group
        orientation="horizontal"
        className="flex-1 min-h-0 overflow-hidden rounded-md border border-zinc-700"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {/* Left column: commit list */}
        <Panel
          id="branch-commits"
          defaultSize="220px"
          minSize="150px"
          maxSize="50%"
        >
          <div className="flex flex-col overflow-hidden h-full">
            <div className="px-2 py-1.5 border-b border-zinc-700">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">
                Commits ({commits.length})
              </span>
            </div>
            <div
              className="flex-1 overflow-y-auto"
              ref={isBranchMode ? scrollRef : undefined}
            >
              {renderCommitList()}
            </div>
          </div>
        </Panel>
        <Separator className="panel-resize-handle" />
        {/* Right: diff viewer panel */}
        <Panel id="branch-diff">
          <div className="min-w-0 min-h-0 overflow-hidden h-full">
            {diffBase ? (
              <DiffViewerPanel
                integrated
                terminalId={terminalId}
                base={diffBase}
                readOnly
                cacheKey={commitsCacheKey}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-zinc-500">
                Select a commit to view changes
              </div>
            )}
          </div>
        </Panel>
      </Group>
      {confirmModal}
    </>
  )
}
