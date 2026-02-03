import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitMerge,
  Loader2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getMergedPRs } from '@/lib/api'
import { TruncatedPath } from './TruncatedPath'

const RECENT_COUNT = 3
const PAGE_SIZE = 5

interface MergedPR {
  prNumber: number
  prTitle: string
  prUrl: string
  branch: string
  repo: string
}

interface MergedPRsListProps {
  repo: string
}

export function MergedPRsList({ repo }: MergedPRsListProps) {
  // Recent merged PRs (always shown)
  const [recentPrs, setRecentPrs] = useState<MergedPR[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [hasMoreAfterRecent, setHasMoreAfterRecent] = useState(false)

  // Expanded merged PRs (after recent)
  const [expanded, setExpanded] = useState(false)
  const [morePrs, setMorePrs] = useState<MergedPR[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadedMore, setLoadedMore] = useState(false)

  const [owner, repoName] = repo.split('/')

  // Load recent merged PRs on mount
  useEffect(() => {
    let cancelled = false
    async function loadRecent() {
      setRecentLoading(true)
      try {
        const result = await getMergedPRs(owner, repoName, RECENT_COUNT, 0)
        if (!cancelled) {
          setRecentPrs(result.prs)
          setHasMoreAfterRecent(result.hasMore)
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) {
          setRecentLoading(false)
        }
      }
    }
    loadRecent()
    return () => {
      cancelled = true
    }
  }, [owner, repoName])

  const loadMore = useCallback(
    async (offset: number) => {
      setLoading(true)
      try {
        const result = await getMergedPRs(
          owner,
          repoName,
          PAGE_SIZE,
          RECENT_COUNT + offset,
        )
        if (offset === 0) {
          setMorePrs(result.prs)
        } else {
          setMorePrs((prev) => [...prev, ...result.prs])
        }
        setHasMore(result.hasMore)
        setLoadedMore(true)
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    },
    [owner, repoName],
  )

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    if (next && !loadedMore) {
      loadMore(0)
    }
  }

  // Don't render anything if no recent PRs and still loading
  if (recentLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 px-2 py-0.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Loading merged PRs...</span>
      </div>
    )
  }

  // Don't render if no merged PRs at all
  if (recentPrs.length === 0) {
    return null
  }

  return (
    <div>
      {/* Recent merged PRs - always visible */}
      {recentPrs.map((pr) => (
        <a
          href={pr.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          key={pr.prNumber}
          className="group/mpr flex items-center cursor-pointer gap-2 pr-3 pl-2 py-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
        >
          <GitMerge className="w-4 h-4 flex-shrink-0 text-purple-500" />
          <div className="flex-1 min-w-0">
            <span className="text-xs truncate block">{pr.prTitle}</span>
            <div className="flex gap-1 items-center">
              <GitBranch className="w-2.5 h-2.5" />
              <TruncatedPath
                className="text-[11px] text-muted-foreground/50"
                path={pr.branch}
              />
            </div>
          </div>
        </a>
      ))}

      {/* Expandable section for older merged PRs */}
      {hasMoreAfterRecent && (
        <>
          <button
            type="button"
            onClick={toggle}
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground/50 px-2 py-0.5 hover:text-muted-foreground transition-colors w-full"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
            )}
            <GitMerge className="w-3 h-3" />
            <span>Older merged PRs</span>
            {loading && !loadedMore && (
              <Loader2 className="w-3 h-3 animate-spin ml-auto" />
            )}
          </button>
          {expanded && (
            <>
              {morePrs.map((pr) => (
                <a
                  href={pr.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  key={pr.prNumber}
                  className="group/mpr flex items-center cursor-pointer gap-2 pr-3 pl-2 py-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
                >
                  <GitMerge className="w-4 h-4 flex-shrink-0 text-purple-500" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs truncate block">{pr.prTitle}</span>
                    <div className="flex gap-1 items-center">
                      <GitBranch className="w-2.5 h-2.5" />
                      <TruncatedPath
                        className="text-[11px] text-muted-foreground/50"
                        path={pr.branch}
                      />
                    </div>
                  </div>
                </a>
              ))}
              {loading && loadedMore && (
                <div className="flex items-center justify-center py-1">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50" />
                </div>
              )}
              {hasMore && !loading && (
                <button
                  type="button"
                  onClick={() => loadMore(morePrs.length)}
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground px-4 py-0.5 cursor-pointer transition-colors"
                >
                  Load more...
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
