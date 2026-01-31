import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Command,
  Copy,
  ExternalLink,
  GitBranch,
  Globe,
  MoreVertical,
  Pencil,
  TerminalSquare as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { useSessionContext } from '@/context/SessionContext'
import { useCmdHeld } from '@/hooks/useCmdHeld'
import { cn } from '@/lib/utils'
import { useTerminalContext } from '../context/TerminalContext'
import type { SessionWithProject, Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { EditTerminalModal } from './EditTerminalModal'
import { PRStatusContent } from './PRStatusContent'
import { SessionItem } from './SessionItem'
import { TruncatedPath } from './TruncatedPath'

interface TerminalItemProps {
  terminal: Terminal
  hideFolder?: boolean
  sessions?: SessionWithProject[]
  sessionsExpanded?: boolean
  onToggleSessions?: () => void
  githubExpanded?: boolean
  onToggleGitHub?: () => void
}

export function TerminalItem({
  terminal,
  hideFolder,
  sessions = [],
  sessionsExpanded = true,
  onToggleSessions,
  githubExpanded: githubExpandedProp,
  onToggleGitHub,
}: TerminalItemProps) {
  const { terminals, activeTerminal, selectTerminal } = useTerminalContext()
  const { createTerminal, updateTerminal, deleteTerminal } =
    useTerminalContext()
  const { clearSession } = useSessionContext()
  const cmdHeld = useCmdHeld()
  const shortcutIndex = terminals.findIndex((t) => t.id === terminal.id) + 1
  const {
    githubPRs,
    hasNewActivity,
    markPRSeen,
    processes: allProcesses,
    terminalPorts,
  } = useTerminalContext()
  const processes = allProcesses.filter((p) => p.terminalId === terminal.id)
  const ports = terminalPorts[terminal.id] ?? []
  const prForBranch = terminal.git_branch
    ? (githubPRs.find(
      (pr) => pr.branch === terminal.git_branch && pr.state === 'OPEN',
    ) ??
      githubPRs.find(
        (pr) => pr.branch === terminal.git_branch && pr.state === 'MERGED',
      ))
    : undefined
  const hasGitHub = !!prForBranch
  const isActive = terminal.id === activeTerminal?.id
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [processesExpanded, setProcessesExpanded] = useState(false)
  const [localGitHubExpanded, setLocalGitHubExpanded] = useState(true)
  const githubExpanded = githubExpandedProp ?? localGitHubExpanded
  const toggleGitHub =
    onToggleGitHub ?? (() => setLocalGitHubExpanded((v) => !v))
  const [sessionsListExpanded, setSessionsListExpanded] = useState(true)
  const [portsExpanded, setPortsExpanded] = useState(false)
  const isSettingUp =
    terminal.git_repo?.status === 'setup' || terminal.setup?.status === 'setup'
  const isDeleting = terminal.setup?.status === 'delete'
  const displayName = terminal.name || terminal.cwd || 'Untitled'
  const hasSessions = sessions.length > 0
  const hasProcesses = processes.length > 0
  const hasPorts = ports.length > 0

  const gitBranch = terminal.git_branch

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleSessions?.()
  }

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleEditClick = () => {
    setShowMenu(false)
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

  const handleDeleteClick = () => {
    setShowMenu(false)
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    deleteTerminal(terminal.id)
  }

  const handleAddWorkspace = async () => {
    setShowMenu(false)
    const repo = terminal.git_repo!.repo
    const baseName = terminal.name || repo.split('/').pop()!
    try {
      const newTerminal = await createTerminal({
        cwd: '~',
        name: `${baseName} 2`,
        source_terminal_id: terminal.id,
      })
      selectTerminal(newTerminal.id)
      clearSession()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to add workspace',
      )
    }
  }

  return (
    <>
      <div>
        <div
          onClick={() => {
            if (isSettingUp || isDeleting) return
            selectTerminal(terminal.id)
            clearSession()
            if (!sessionsExpanded) {
              onToggleSessions?.()
            }
          }}
          className={cn(
            `group flex relative gap-1 items-center pl-1 pr-2 py-1.5 transition-colors ${isSettingUp || isDeleting
              ? 'opacity-60 cursor-default'
              : `cursor-pointer ${isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              }`
            } ${terminal.orphaned ? 'opacity-60' : ''}`,
            !hasSessions &&
            !hasProcesses &&
            !hasGitHub &&
            !hasPorts &&
            'pl-2.5',
            hideFolder && 'rounded-l-lg',
          )}
        >
          {hasSessions || hasProcesses || hasGitHub || hasPorts ? (
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
            ) : (
              terminal.ssh_host &&
              terminal.name !== terminal.ssh_host && (
                <span className="text-xs text-muted-foreground">
                  SSH: {terminal.ssh_host}
                </span>
              )
            )}
            {terminal.git_repo?.status === 'setup' && (
              <div className="text-[10px] text-blue-400">
                Cloning repository...
              </div>
            )}
            {terminal.git_repo?.status === 'failed' && (
              <div className="text-[10px] text-destructive break-all">
                Clone failed: {terminal.git_repo.error}
              </div>
            )}
            {terminal.git_repo?.status === 'done' && (
              <>
                {terminal.setup?.status === 'setup' && (
                  <div className="text-[10px] text-blue-400">
                    Running setup...
                  </div>
                )}
                {terminal.setup?.status === 'failed' && (
                  <div className="text-[10px] text-destructive break-all">
                    {terminal.setup.error}
                  </div>
                )}
                {terminal.setup?.status === 'delete' && (
                  <div className="text-[10px] text-blue-400">
                    Running teardown...
                  </div>
                )}
              </>
            )}
            {gitBranch && terminal.setup?.status !== 'delete' && (
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
            <div className="absolute invisible group-hover:visible top-1 right-1">
              {(!isSettingUp && !isDeleting) && (<Popover open={showMenu} onOpenChange={setShowMenu}>
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={handleMenuClick}
                    className="h-7 w-7 text-muted-foreground !w-[20px]"
                  >
                    <MoreVertical className="w-3 h-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-40 p-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {terminal.git_repo && (
                    <button
                      type="button"
                      onClick={handleAddWorkspace}
                      className="flex cursor-pointer items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-sidebar-accent/50 text-left"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Add Workspace
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleEditClick}
                    className="flex cursor-pointer items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-sidebar-accent/50 text-left"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteClick}
                    className="flex cursor-pointer items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-sidebar-accent/50 text-left text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </PopoverContent>
              </Popover>)}
            </div>
          )}
        </div>

        {(hasGitHub || hasProcesses || hasPorts || hasSessions) &&
          sessionsExpanded && (
            <div className="ml-2 space-y-0.5">
              {hasGitHub && prForBranch && (
                <PRStatusContent
                  pr={prForBranch}
                  expanded={githubExpanded}
                  onToggle={toggleGitHub}
                  hasNewActivity={hasNewActivity(prForBranch)}
                  onSeen={() => markPRSeen(prForBranch)}
                />
              )}
              {hasProcesses && (
                <>
                  <button
                    type="button"
                    onClick={() => setProcessesExpanded((v) => !v)}
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
              {hasPorts && (
                <>
                  <button
                    type="button"
                    onClick={() => setPortsExpanded((v) => !v)}
                    className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-1 hover:text-muted-foreground transition-colors"
                  >
                    {portsExpanded ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    Ports ({ports.length})
                  </button>
                  {portsExpanded &&
                    ports.map((port) => (
                      <a
                        key={port}
                        href={`http://localhost:${port}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center group/port ml-4 gap-2 px-2 py-1 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                      >
                        <span className="text-xs">{port}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 hidden group-hover/port:block" />
                      </a>
                    ))}
                </>
              )}
              {sessions.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setSessionsListExpanded(!sessionsListExpanded)
                    }
                    className="flex cursor-pointer w-full items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 pt-1"
                  >
                    {sessionsListExpanded ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    Claude ({sessions.length})
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
