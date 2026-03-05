import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import useSWR from 'swr'
import { toast } from '@/components/ui/sonner'
import { getBranchCommits, getCommitsBetween, type PRCommit } from '@/lib/api'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { DiffViewerPanel } from './DiffViewerPanel'

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

  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)

  // ── Mode A: SWR fetch for base..head comparison ──
  const { data: compareData, isLoading: loadingCompare } = useSWR(
    !isBranchMode
      ? [
          'commits-between',
          terminalId,
          props.baseBranch,
          props.headBranch,
          props.cacheKey ?? '',
        ]
      : null,
    async ([, tid, base, head]) => {
      return await getCommitsBetween(
        tid as number,
        base as string,
        head as string,
      )
    },
    { revalidateOnFocus: false },
  )

  // ── Mode B: paginated fetch for single branch ──
  const [branchCommits, setBranchCommits] = useState<PRCommit[]>([])
  const [mergeBase, setMergeBase] = useState<string | undefined>()
  const [mergeBaseBranch, setMergeBaseBranch] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loadingBranch, setLoadingBranch] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)

  // Initial fetch for branch mode
  useEffect(() => {
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

  return (
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
                {commits.map((commit) => {
                  const isMergeBase = mergeBase && commit.hash === mergeBase
                  return (
                    <div key={commit.hash}>
                      {isMergeBase && (
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
                        onClick={() =>
                          setSelectedCommit(
                            selectedCommit === commit.hash ? null : commit.hash,
                          )
                        }
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
            )}
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
  )
}
