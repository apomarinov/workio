import { ChevronDown, ChevronRight, Folder, GitBranch } from 'lucide-react'
import { useMemo } from 'react'
import type { SessionWithProject } from '../types'
import { SessionItem } from './SessionItem'
import { TruncatedPath } from './TruncatedPath'

interface SessionGroupProps {
  projectPath: string
  sessions: SessionWithProject[]
  expanded: boolean
  onToggle: () => void
}

export function SessionGroup({
  projectPath,
  sessions,
  expanded,
  onToggle,
}: SessionGroupProps) {
  // Get git branch from the most recent active session
  const gitBranch = useMemo(() => {
    const activeSessions = sessions.filter(
      (s) => s.status === 'active' || s.status === 'permission_needed',
    )
    const session = activeSessions[0] || sessions[0]
    return session?.git_branch || null
  }, [sessions])

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
            <TruncatedPath path={projectPath} className="text-sm font-medium" />
          </div>
          {gitBranch && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="w-3 h-3" />
              {gitBranch}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {sessions.length}
        </span>
      </div>
      {expanded && (
        <div className="ml-4 mt-1 space-y-0.5">
          {sessions.map((session) => (
            <SessionItem key={session.session_id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}
