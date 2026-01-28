import { ChevronDown, ChevronRight, Folder, GitBranch } from 'lucide-react'
import { useMemo } from 'react'
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

export function FolderGroup({
  cwd,
  terminals,
  expanded,
  onToggle,
  sessionsForTerminal,
  expandedTerminalSessions,
  onToggleTerminalSessions,
}: FolderGroupProps) {
  // Get git branch from the most recent active session
  const gitBranch = useMemo(() => {
    const allSessions = terminals.flatMap(
      (t) => sessionsForTerminal.get(t.id) || [],
    )
    // Prefer active/permission_needed sessions, then most recent
    const activeSessions = allSessions.filter(
      (s) => s.status === 'active' || s.status === 'permission_needed',
    )
    const session = activeSessions[0] || allSessions[0]
    return session?.git_branch || null
  }, [terminals, sessionsForTerminal])

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
            <Folder className="w-4 h-4 flex-shrink-0" />
            <TruncatedPath path={cwd} className="text-sm font-medium" />
          </div>
          {gitBranch && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="w-3 h-3" />
              {gitBranch}
            </span>
          )}
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
              onToggleSessions={() => onToggleTerminalSessions(terminal.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
