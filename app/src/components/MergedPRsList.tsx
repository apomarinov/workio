import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitMerge,
  Loader2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { getMergedPRs } from '@/lib/api'
import { TruncatedPath } from './TruncatedPath'

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
  const [expanded, setExpanded] = useState(false)
  const [prs, setPrs] = useState<MergedPR[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [owner, repoName] = repo.split('/')

  const load = useCallback(
    async (offset: number) => {
      setLoading(true)
      try {
        const result = await getMergedPRs(owner, repoName, PAGE_SIZE, offset)
        if (offset === 0) {
          setPrs(result.prs)
        } else {
          setPrs((prev) => [...prev, ...result.prs])
        }
        setHasMore(result.hasMore)
        setLoaded(true)
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
    if (next && !loaded) {
      load(0)
    }
  }

  return (
    <div>
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
        <span>Merged PRs</span>
        {loading && !loaded && (
          <Loader2 className="w-3 h-3 animate-spin ml-auto" />
        )}
      </button>
      {expanded && (
        <>
          {prs.map((pr) => (
            <a
              href={pr.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              key={pr.prNumber}
              className="group/mpr flex items-center cursor-pointer gap-2 pr-3 pl-4 py-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
            >
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
          {loading && loaded && (
            <div className="flex items-center justify-center py-1">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50" />
            </div>
          )}
          {hasMore && !loading && (
            <button
              type="button"
              onClick={() => load(prs.length)}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground px-4 py-0.5 cursor-pointer transition-colors"
            >
              Load more...
            </button>
          )}
        </>
      )}
    </div>
  )
}
