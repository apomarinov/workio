import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  Globe,
  MoreVertical,
  Pencil,
  TerminalSquare as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { useSessionContext } from '@/context/SessionContext'
import { useModifiersHeld } from '@/hooks/useKeyboardShortcuts'
import { cn } from '@/lib/utils'
import { useTerminalContext } from '../context/TerminalContext'
import type { SessionWithProject, Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { EditTerminalModal } from './EditTerminalModal'
import { PRStatusContent, PRTabButton } from './PRStatusContent'
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
  const { createTerminal, updateTerminal, deleteTerminal } =
    useTerminalContext()
  const { clearSession } = useSessionContext()
  const { isGoToTabModifierHeld, modifierIcons } = useModifiersHeld()
  const shortcutIndex = terminals.findIndex((t) => t.id === terminal.id) + 1
  const {
    githubPRs,
    hasNewActivity,
    markPRSeen,
    processes: allProcesses,
    terminalPorts,
    gitDirtyStatus,
  } = useTerminalContext()
  const processes = useMemo(
    () => allProcesses.filter((p) => p.terminalId === terminal.id),
    [allProcesses, terminal.id],
  )
  const ports = terminalPorts[terminal.id] ?? []
  const prForBranch = useMemo(
    () =>
      terminal.git_branch
        ? (githubPRs.find(
            (pr) => pr.branch === terminal.git_branch && pr.state === 'OPEN',
          ) ??
          githubPRs.find(
            (pr) => pr.branch === terminal.git_branch && pr.state === 'MERGED',
          ))
        : undefined,
    [githubPRs, terminal.git_branch],
  )
  const diffStat = gitDirtyStatus[terminal.id]
  const isDirty = !!diffStat && (diffStat.added > 0 || diffStat.removed > 0)
  const hasGitHub = !!prForBranch
  const isActive = terminal.id === activeTerminal?.id
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteDirectory, setDeleteDirectory] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [activeTab, _setActiveTab] = useState<
    'processes' | 'ports' | 'prs' | null
  >(null)
  const setActiveTab = (v: typeof activeTab) => {
    _setActiveTab((o) => {
      if (o === v) {
        return null
      }
      return v
    })
  }
  const [sessionsListExpanded, setSessionsListExpanded] = useState(true)
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
    setDeleteDirectory(false)
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    deleteTerminal(terminal.id, { deleteDirectory })
  }

  const handleAddWorkspace = async () => {
    setShowMenu(false)
    try {
      const newTerminal = await createTerminal({
        cwd: '~',
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

  const handleOpenCursor = () => {
    setShowMenu(false)
    window.open(`cursor://file/${terminal.cwd}`)
  }

  return (
    <>
      <div>
        <div
          data-terminal-id={terminal.id}
          onClick={() => {
            selectTerminal(terminal.id)
            clearSession()
            if (!sessionsExpanded && !isSettingUp && !isDeleting) {
              onToggleSessions?.()
            }
          }}
          className={cn(
            `group flex relative gap-1 items-center pl-1 pr-2 py-1.5 transition-colors  ${`cursor-pointer ${
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            }`} ${terminal.orphaned || isSettingUp || isDeleting ? 'opacity-60' : ''}`,
            ((!hasSessions &&
              !hasProcesses &&
              !hasGitHub &&
              !hasPorts &&
              !isDirty) ||
              isSettingUp ||
              isDeleting) &&
              'pl-2.5',
            hideFolder && 'rounded-l-lg',
          )}
        >
          {!isSettingUp &&
          !isDeleting &&
          (hasSessions || hasProcesses || hasGitHub || hasPorts || isDirty) ? (
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
            {terminal.git_repo?.status === 'done' && (
              <>
                {terminal.setup?.status === 'setup' && (
                  <div className="text-[10px] text-blue-400">
                    Running setup...
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
                <GitBranch className={cn('w-2.5 h-2.5 text-zinc-400')} />
                {gitBranch}
              </span>
            )}
          </div>
          {isGoToTabModifierHeld && shortcutIndex >= 1 ? (
            <span className="text-sm flex items-center gap-1 text-muted-foreground font-medium tabular-nums font-mono">
              {modifierIcons.goToTab('w-3 h-3')}
              {shortcutIndex}
            </span>
          ) : (
            <div className="absolute invisible group-hover:visible top-1 right-1">
              {!isSettingUp && !isDeleting && (
                <Popover open={showMenu} onOpenChange={setShowMenu}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={handleMenuClick}
                      className={cn(
                        'h-7 w-7 text-muted-foreground !bg-transparent group-hover:!bg-zinc-800/80 !w-[20px] hover:!bg-zinc-800',
                      )}
                    >
                      <MoreVertical className="w-3 h-3 stroke-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-40 p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!terminal.ssh_host && (
                      <button
                        type="button"
                        onClick={handleOpenCursor}
                        className="flex cursor-pointer items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-sidebar-accent/50 text-left"
                      >
                        <svg
                          fill="currentColor"
                          fillRule="evenodd"
                          viewBox="0 0 24 24"
                          className="w-3.5 h-3.5"
                        >
                          <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
                        </svg>
                        Cursor
                      </button>
                    )}
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
                </Popover>
              )}
            </div>
          )}
        </div>
        {terminal.setup?.status === 'failed' && (
          <div className="ml-5 text-[11px] text-destructive break-all">
            {terminal.setup.error}
          </div>
        )}
        {terminal.git_repo?.status === 'failed' && (
          <div className="ml-5 text-[11px] text-destructive break-all">
            Clone failed: {terminal.git_repo.error}
          </div>
        )}
        {(hasGitHub || hasProcesses || hasPorts || isDirty || hasSessions) &&
          sessionsExpanded && (
            <div className="ml-2 space-y-0.5">
              {(hasGitHub || hasProcesses || hasPorts || isDirty) && (
                <>
                  <div className="flex items-center px-2 pt-1 flex-wrap">
                    {hasGitHub && prForBranch && (
                      <PRTabButton
                        pr={prForBranch}
                        active={activeTab === 'prs' && isActive}
                        className="whitespace-nowrap"
                        hasNewActivity={hasNewActivity(prForBranch)}
                        onClick={() => {
                          setActiveTab('prs')
                          markPRSeen(prForBranch)
                        }}
                      />
                    )}
                    {hasProcesses && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('processes')}
                        className={cn(
                          'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                          activeTab === 'processes'
                            ? 'text-foreground bg-sidebar-accent'
                            : 'text-muted-foreground/60 hover:text-muted-foreground',
                        )}
                      >
                        Processes ({processes.length})
                      </button>
                    )}
                    {hasPorts && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('ports')}
                        className={cn(
                          'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                          activeTab === 'ports'
                            ? 'text-foreground bg-sidebar-accent'
                            : 'text-muted-foreground/60 hover:text-muted-foreground',
                        )}
                      >
                        Ports ({ports.length})
                      </button>
                    )}
                    {isDirty && diffStat && (
                      <span
                        className={cn(
                          'text-[10px] opacity-60 tracking-wider px-1.5 py-0.5 rounded font-mono',
                          isActive && 'opacity-80',
                        )}
                      >
                        {diffStat.added > 0 && (
                          <span className="text-green-500/80">
                            +{diffStat.added}
                          </span>
                        )}
                        {diffStat.added > 0 && diffStat.removed > 0 && '/'}
                        {diffStat.removed > 0 && (
                          <span className="text-red-500/80">
                            -{diffStat.removed}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div>
                    {activeTab === 'processes' &&
                      hasProcesses &&
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
                    {activeTab === 'ports' &&
                      hasPorts &&
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
                    {activeTab === 'prs' && hasGitHub && prForBranch && (
                      <PRStatusContent
                        pr={prForBranch}
                        expanded={true}
                        hasNewActivity={hasNewActivity(prForBranch)}
                        onSeen={() => markPRSeen(prForBranch)}
                      />
                    )}
                  </div>
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
        terminal={terminal}
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
      >
        {terminal.git_repo && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={deleteDirectory}
              onCheckedChange={(v) => setDeleteDirectory(v === true)}
              className="w-5 h-5"
            />
            Also delete workspace directory
          </label>
        )}
      </ConfirmModal>
    </>
  )
}
