import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Pencil,
  TerminalSquare as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSessionContext } from '@/context/SessionContext'
import { cn } from '@/lib/utils'
import { useTerminalContext } from '../context/TerminalContext'
import { useProcesses } from '../hooks/useProcesses'
import { useTerminals } from '../hooks/useTerminals'
import type { SessionWithProject, Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { EditTerminalModal } from './EditTerminalModal'
import { SessionItem } from './SessionItem'
import { TruncatedPath } from './TruncatedPath'

interface TerminalItemProps {
  terminal: Terminal
  hideFolder?: boolean
  sessions?: SessionWithProject[]
  sessionsExpanded?: boolean
  onToggleSessions?: () => void
}

export function TerminalItem({
  terminal,
  hideFolder,
  sessions = [],
  sessionsExpanded = true,
  onToggleSessions,
}: TerminalItemProps) {
  const { activeTerminal, selectTerminal } = useTerminalContext()
  const { updateTerminal, deleteTerminal } = useTerminals()
  const { clearSession } = useSessionContext()
  const allProcesses = useProcesses()
  const processes = allProcesses.filter((p) => p.terminalId === terminal.id)
  const isActive = terminal.id === activeTerminal?.id
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [processesExpanded, setProcessesExpanded] = useState(true)
  const [sessionsListExpanded, setSessionsListExpanded] = useState(true)
  const displayName = terminal.name || terminal.cwd || 'Untitled'
  const hasSessions = sessions.length > 0
  const hasProcesses = processes.length > 0

  // Get git branch from the most recent active session
  const gitBranch = useMemo(() => {
    const activeSessions = sessions.filter(
      (s) => s.status === 'active' || s.status === 'permission_needed',
    )
    const session = activeSessions[0] || sessions[0]
    return session?.git_branch || null
  }, [sessions])

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleSessions?.()
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowEditModal(true)
  }

  const handleEditSave = (name: string) => {
    setShowEditModal(false)
    updateTerminal(terminal.id, { name })
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    deleteTerminal(terminal.id)
  }

  return (
    <>
      <div>
        <div
          onClick={() => {
            selectTerminal(terminal.id)
            clearSession()
            if (!sessionsExpanded) {
              onToggleSessions?.()
            }
          }}
          className={`group flex items-center gap-2 min-h-14 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
          } ${terminal.orphaned ? 'opacity-60' : ''}`}
        >
          {hasSessions || hasProcesses ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleChevronClick}
              className="h-6 w-6 flex-shrink-0"
            >
              {sessionsExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          ) : (
            <div
              className={cn(
                'h-6 w-6 flex-shrink-0',
                !hideFolder ? 'hidden' : '',
              )}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {terminal.orphaned ? (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-yellow-500" />
              ) : (
                <TerminalIcon
                  className={`w-4 h-4 flex-shrink-0 ${hasProcesses ? 'text-green-500' : ''}`}
                />
              )}
              <TruncatedPath
                path={displayName}
                className="text-sm font-medium truncate"
              />
            </div>
            {terminal.orphaned ? (
              <p className="text-xs truncate text-yellow-500">Path not found</p>
            ) : (
              !hideFolder &&
              terminal.name && (
                <TruncatedPath
                  path={terminal.cwd}
                  className="text-xs text-muted-foreground"
                />
              )
            )}
            {gitBranch && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="w-3 h-3" />
                {gitBranch}
              </span>
            )}
          </div>
          <div className="h-7 invisible pointer-events-none"></div>
          <div className="hidden group-hover:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEditClick}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDeleteClick}
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {(hasProcesses || hasSessions) && sessionsExpanded && (
          <div className="ml-7 mt-1 space-y-0.5">
            {hasProcesses && (
              <>
                <button
                  type="button"
                  onClick={() => setProcessesExpanded(!processesExpanded)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1 hover:text-muted-foreground transition-colors"
                >
                  {processesExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Processes ({processes.length})
                </button>
                {processesExpanded &&
                  processes.map((process) => (
                    <div
                      key={`${process.pid}-${process.command}`}
                      className="flex items-center gap-2 px-2 py-1 rounded text-sidebar-foreground/70"
                    >
                      <Activity className="w-3 h-3 flex-shrink-0 text-green-500" />
                      <span className="text-xs truncate">
                        {process.command}
                      </span>
                    </div>
                  ))}
              </>
            )}
            {sessions.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSessionsListExpanded(!sessionsListExpanded)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1 hover:text-muted-foreground transition-colors"
                >
                  {sessionsListExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Sessions ({sessions.length})
                </button>
                {sessionsListExpanded &&
                  sessions.map((session) => (
                    <SessionItem key={session.session_id} session={session} />
                  ))}
              </>
            )}
          </div>
        )}
      </div>

      <EditTerminalModal
        open={showEditModal}
        currentName={terminal.name || ''}
        onSave={handleEditSave}
        onCancel={() => setShowEditModal(false)}
      />

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Terminal"
        message={`Are you sure you want to delete "${displayName}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  )
}
