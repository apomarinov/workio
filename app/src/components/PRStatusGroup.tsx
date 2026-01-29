import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import type { PRCheckStatus } from '../../shared/types'
import { PRStatusContent } from './PRStatusContent'

interface PRStatusGroupProps {
  pr: PRCheckStatus
  expanded: boolean
  onToggle: () => void
}

export function PRStatusGroup({ pr, expanded, onToggle }: PRStatusGroupProps) {
  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-start gap-2 pr-3 pl-2 py-2 rounded-lg cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 flex-shrink-0 text-zinc-400" />
            <span className="text-sm font-medium truncate">{pr.branch}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          #{pr.prNumber}
        </span>
      </div>
      {expanded && (
        <div className="ml-4 mt-1">
          <PRStatusContent pr={pr} />
        </div>
      )}
    </div>
  )
}
