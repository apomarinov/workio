import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  GitBranch,
  Globe,
  Pencil,
  TerminalSquare as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { useKeyMapContext } from '@/context/KeyMapContext'
import { useSessionContext } from '@/context/SessionContext'
import { cn } from '@/lib/utils'
import { useTerminalContext } from '../context/TerminalContext'
import { useProcesses } from '../hooks/useProcesses'
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
  const { terminals, activeTerminal, selectTerminal } = useTerminalContext()
  const { updateTerminal, deleteTerminal } = useTerminalContext()
  const { clearSession } = useSessionContext()
  const { cmdHeld } = useKeyMapContext()
  const shortcutIndex = terminals.findIndex((t) => t.id === terminal.id) + 1
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

  const handleEditSave = async (updates: { name: string; cwd?: string }) => {
    try {
      await updateTerminal(terminal.id, updates)
      setShowEditModal(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update terminal',
      )
    }
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
          className={cn(
            `group flex items-center pl-1 pr-2 py-2 rounded-lg cursor-pointer transition-colors ${isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            } ${terminal.orphaned ? 'opacity-60' : ''}`,
            !hasSessions && !hasProcesses && 'pl-2.5',
          )}
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
              {terminal.ssh_host ? (
                <Globe className="w-4 h-4 flex-shrink-0 text-blue-400" />
              ) : terminal.orphaned ? (
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
            ) : terminal.ssh_host ? (
              <>
                {terminal.name !== terminal.ssh_host && (
                  <span className="text-xs text-muted-foreground">
                    SSH: {terminal.ssh_host}
                  </span>
                )}
              </>
            ) : (
              !hideFolder &&
              terminal.name && (
                <div className='flex gap-1 items-center'>
                  <Folder className='w-2.5 h-2.5 text-zinc-400' />
                  <TruncatedPath
                    path={terminal.cwd}
                    className="text-[10px] text-muted-foreground"
                  />
                </div>
              )
            )}
            {gitBranch && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <GitBranch className="w-2.5 h-2.5 text-zinc-400" />
                {gitBranch}
              </span>
            )}
          </div>
          {cmdHeld && shortcutIndex >= 1 && shortcutIndex <= 9 ? (
            <span className="flex items-center gap-0.5 text-sm text-muted-foreground font-medium tabular-nums">
              <Command className="w-3 h-3" />
              {shortcutIndex}
            </span>
          ) : (
            <>
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
            </>
          )}
        </div>

        {(hasProcesses || hasSessions) && sessionsExpanded && (
          <div className="ml-7 mt-1 space-y-0.5">
            {hasProcesses && (
              <>
                <button
                  type="button"
                  onClick={() => setProcessesExpanded(!processesExpanded)}
                  className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1 hover:text-muted-foreground transition-colors"
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
        currentCwd={terminal.cwd}
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
