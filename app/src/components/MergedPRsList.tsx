import {
  ChevronDown,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  Loader2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getClosedPRs } from '@/lib/api'
import type { MergedPRSummary } from '../../shared/types'
import { TruncatedPath } from './TruncatedPath'

const RECENT_COUNT = 3 // Skip first 3 (shown from context)
const PAGE_SIZE = 10

interface OlderMergedPRsListProps {
  repo: string
  excludePRNumbers?: Set<number>
}

export function OlderMergedPRsList({
  repo,
  excludePRNumbers,
}: OlderMergedPRsListProps) {
  const [expanded, setExpanded] = useState(false)
  const [prs, setPrs] = useState<MergedPRSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkedForMore, setCheckedForMore] = useState(false)

  const [owner, repoName] = repo.split('/')

  // Check if there are older PRs on mount
  useEffect(() => {
    let cancelled = false
    async function checkForMore() {
      try {
        // Just check if there's at least one PR after the first 3
        const result = await getClosedPRs(owner, repoName, 1, RECENT_COUNT)
        if (!cancelled) {
          setHasMore(result.prs.length > 0)
          setCheckedForMore(true)
        }
      } catch {
        if (!cancelled) {
          setCheckedForMore(true)
        }
      }
    }
    checkForMore()
    return () => {
      cancelled = true
    }
  }, [owner, repoName])

  const loadMore = useCallback(
    async (offset: number) => {
      setLoading(true)
      try {
        const result = await getClosedPRs(
          owner,
          repoName,
          PAGE_SIZE,
          RECENT_COUNT + offset,
        )
        if (offset === 0) {
          setPrs(result.prs)
        } else {
          setPrs((prev) => [...prev, ...result.prs])
        }
        setHasMore(result.hasMore)
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
    if (next && prs.length === 0) {
      loadMore(0)
    }
  }

  // Don't render if we haven't checked yet or there are no older PRs
  if (!checkedForMore || !hasMore) {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="flex cursor-pointer items-center pl-3.5 gap-1.5 text-[11px] text-muted-foreground/50 px-2 py-0.5 hover:text-muted-foreground transition-colors w-full"
      >
        {loading && prs.length === 0 ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : expanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <div className="w-3 h-3 flex-shrink-0" />
        )}

        <span>Show More</span>
      </button>
      {expanded && (
        <>
          {prs
            .filter((pr) => !excludePRNumbers?.has(pr.prNumber))
            .map((pr) => (
              <a
                href={pr.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                key={pr.prNumber}
                className="group/mpr flex items-center cursor-pointer gap-2 pr-3 pl-2 py-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
              >
                {pr.state === 'MERGED' ? (
                  <GitMerge className="w-4 h-4 flex-shrink-0 text-purple-500/70" />
                ) : (
                  <GitPullRequestArrow className="w-4 h-4 flex-shrink-0 text-red-500/70" />
                )}
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
          {loading && prs.length > 0 && (
            <div className="flex items-center justify-center py-1">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50" />
            </div>
          )}
          {hasMore && !loading && (
            <button
              type="button"
              onClick={() => loadMore(prs.length)}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground px-4 py-0.5 cursor-pointer transition-colors"
            >
              Load more...
            </button>
          )}
        </>
      )}
    </>
  )
}
