import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { memo } from 'react'
import type { SessionWithProject, Terminal } from '../types'
import { TerminalItem } from './TerminalItem'
import { TruncatedPath } from './TruncatedPath'

interface FolderGroupProps {
  cwd: string
  terminals: Terminal[]
  expanded: boolean
  onToggle: () => void
  sessionsForTerminal: Map<number, SessionWithProject[]>
  expandedTerminalSessions: Set<number>
  onToggleTerminalSessions: (terminalId: number) => void
}

export const FolderGroup = memo(function FolderGroup({
  cwd,
  terminals,
  expanded,
  onToggle,
  sessionsForTerminal,
  expandedTerminalSessions,
  onToggleTerminalSessions,
}: FolderGroupProps) {
  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-start gap-2 pr-3 pl-2 py-1.5 cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 flex-shrink-0" />
            <TruncatedPath path={cwd} className="text-sm font-medium" />
          </div>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {terminals.length}
        </span>
      </div>
      {expanded && (
        <div className="ml-4 space-y-1 mt-1">
          {terminals.map((terminal) => (
            <TerminalItem
              key={terminal.id}
              terminal={terminal}
              hideFolder
              sessions={sessionsForTerminal.get(terminal.id) || []}
              sessionsExpanded={expandedTerminalSessions.has(terminal.id)}
              onToggleTerminalSessions={onToggleTerminalSessions}
            />
          ))}
        </div>
      )}
    </div>
  )
})
