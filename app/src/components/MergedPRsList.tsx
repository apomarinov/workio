import {
  ChevronDown,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
} from 'lucide-react'
import { useState } from 'react'
import type { MergedPRSummary } from '../../shared/types'
import { TruncatedPath } from './TruncatedPath'

interface OlderMergedPRsListProps {
  olderPRs: MergedPRSummary[]
}

export function OlderMergedPRsList({ olderPRs }: OlderMergedPRsListProps) {
  const [expanded, setExpanded] = useState(false)

  if (olderPRs.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex cursor-pointer items-center pl-3.5 gap-1.5 text-[11px] text-muted-foreground/50 px-2 py-0.5 hover:text-muted-foreground transition-colors w-full"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <div className="w-3 h-3 flex-shrink-0" />
        )}
        <span>Show More</span>
      </button>
      {expanded &&
        olderPRs.map((pr) => (
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
    </>
  )
}
