import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import type { Terminal } from '../types'
import { TerminalItem } from './TerminalItem'
import { TruncatedPath } from './TruncatedPath'

interface FolderGroupProps {
  cwd: string
  terminals: Terminal[]
  expanded: boolean
  onToggle: () => void
}

export function FolderGroup({
  cwd,
  terminals,
  expanded,
  onToggle,
}: FolderGroupProps) {
  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-center gap-2 pr-3 pl-2 py-2 rounded-lg cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
        )}
        <Folder className="w-4 h-4 flex-shrink-0" />
        <TruncatedPath
          path={cwd}
          className="text-sm font-medium flex-1 min-w-0"
        />
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {terminals.length}
        </span>
      </div>
      {expanded && (
        <div className="ml-4 space-y-1 mt-1">
          {terminals.map((terminal) => (
            <TerminalItem key={terminal.id} terminal={terminal} hideFolder />
          ))}
        </div>
      )}
    </div>
  )
}
