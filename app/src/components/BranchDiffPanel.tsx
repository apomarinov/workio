import { GitCommitHorizontal, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { getCommitsBetween } from '@/lib/api'
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

interface BranchDiffPanelProps {
  terminalId: number
  baseBranch: string
  headBranch: string
  /** Extra suffix for the commits SWR cache key (e.g. headCommitSha) */
  cacheKey?: string
  onNoRemote?: () => void
}

export function BranchDiffPanel({
  terminalId,
  baseBranch,
  headBranch,
  cacheKey,
  onNoRemote,
}: BranchDiffPanelProps) {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)

  const { data, isLoading: loadingCommits } = useSWR(
    ['commits-between', terminalId, baseBranch, headBranch, cacheKey ?? ''],
    async ([, tid, base, head]) => {
      const result = await getCommitsBetween(
        tid as number,
        base as string,
        head as string,
      )
      return result
    },
    { revalidateOnFocus: false },
  )

  const commits = data?.commits ?? []

  // Compute a cache key from commit hashes for the file list
  const commitsCacheKey =
    commits.length > 0
      ? simpleHash(commits.map((c) => c.hash).join(','))
      : undefined

  // Notify parent when noRemote is detected
  useEffect(() => {
    if (data?.noRemote) onNoRemote?.()
  }, [data?.noRemote])

  // Reset selected commit when branches change
  useEffect(() => {
    setSelectedCommit(null)
  }, [baseBranch, headBranch])

  const diffBase = selectedCommit
    ? `${selectedCommit}^..${selectedCommit}`
    : `origin/${baseBranch}...origin/${headBranch}`

  return (
    <div className="flex-1 min-h-0 flex gap-0 overflow-hidden rounded-md border border-zinc-700">
      {/* Left column: commit list */}
      <div className="w-[220px] flex-shrink-0 border-r border-zinc-700 flex flex-col overflow-hidden">
        <div className="px-2 py-1.5 border-b border-zinc-700">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Commits ({commits.length})
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingCommits ? (
            <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : commits.length === 0 ? (
            <div className="py-4 text-center text-sm text-zinc-500">
              No commits
            </div>
          ) : (
            commits.map((commit) => (
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: diff viewer panel */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <DiffViewerPanel
          integrated
          terminalId={terminalId}
          base={diffBase}
          readOnly
          cacheKey={commitsCacheKey}
        />
      </div>
    </div>
  )
}
