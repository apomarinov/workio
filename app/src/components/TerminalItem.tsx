import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GitBranch,
  Globe,
  MoreVertical,
  Pin,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSessionContext } from '@/context/SessionContext'
import { useModifiersHeld } from '@/hooks/useKeyboardShortcuts'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useLongPress } from '@/hooks/useLongPress'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettings } from '@/hooks/useSettings'
import { cancelWorkspace } from '@/lib/api'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import { useProcessContext } from '../context/ProcessContext'
import { useTerminalContext } from '../context/TerminalContext'
import type { SessionWithProject, Terminal } from '../types'
import { TerminalIcon2 } from './icons'
import { PRStatusContent, PRTabButton } from './PRStatusContent'
import { SessionItem } from './SessionItem'
import { ShellTabs } from './ShellTabs'
import { TruncatedPath } from './TruncatedPath'
import {
  GitDirtyBadge,
  PortsList,
  ProcessesList,
} from './terminal-status-sections'

interface TerminalItemProps {
  terminal: Terminal
  hideFolder?: boolean
  sessions?: SessionWithProject[]
  sessionsExpanded?: boolean
  onToggleTerminalSessions?: (terminalId: number) => void
  shortcutIndex?: number
}

export const TerminalItem = memo(function TerminalItem({
  terminal,
  hideFolder,
  sessions = [],
  sessionsExpanded = true,
  onToggleTerminalSessions,
  shortcutIndex: shortcutIndexProp,
}: TerminalItemProps) {
  const { terminals, activeTerminal, selectTerminal } = useTerminalContext()
  const { clearSession } = useSessionContext()
  const { isGoToTabModifierHeld, modifierIcons } = useModifiersHeld()
  const shortcutIndex =
    shortcutIndexProp ?? terminals.findIndex((t) => t.id === terminal.id) + 1
  const isMobile = useIsMobile()
  const longPressHandlers = useLongPress(() => {
    window.dispatchEvent(
      new CustomEvent('open-item-actions', {
        detail: { terminalId: terminal.id, sessionId: null },
      }),
    )
  })
  const { githubPRs } = useTerminalContext()
  const {
    processes: allProcesses,
    terminalPorts,
    shellPorts,
    gitDirtyStatus,
    gitRemoteSyncStatus,
  } = useProcessContext()
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
  const isDirty =
    !!diffStat &&
    (diffStat.added > 0 || diffStat.removed > 0 || diffStat.untracked > 0)
  const remoteSyncStat = gitRemoteSyncStatus[terminal.id]
  const showRemoteSync =
    !!remoteSyncStat &&
    (remoteSyncStat.noRemote ||
      remoteSyncStat.behind > 0 ||
      remoteSyncStat.ahead > 0)
  const hasGitHub = !!prForBranch
  const isActive = terminal.id === activeTerminal?.id
  const [pinnedTerminalSessions] = useLocalStorage<number[]>(
    'sidebar-pinned-terminal-sessions',
    [],
  )
  const isTerminalPinned = pinnedTerminalSessions.includes(terminal.id)
  const [tabBar] = useLocalStorage('shell-tabs-bar', true)
  const { settings } = useSettings()
  const statusBarEnabled = !!settings?.statusBar?.enabled
  const showSidebarShells = !tabBar

  // Track which shell is active for sidebar display (mirrors Terminal.tsx state via events)
  const mainShell = terminal.shells.find((s) => s.name === 'main')
  const [sidebarActiveShellId, setSidebarActiveShellId] = useState(
    mainShell?.id ?? 0,
  )

  // Listen for shell-select events to keep sidebar in sync
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; shellId: number }>,
    ) => {
      if (e.detail.terminalId === terminal.id) {
        setSidebarActiveShellId(e.detail.shellId)
      }
    }
    window.addEventListener('shell-select', handler as EventListener)
    return () => {
      window.removeEventListener('shell-select', handler as EventListener)
    }
  }, [terminal.id])

  const [activeTab, _setActiveTab] = useState<
    'processes' | 'ports' | 'prs' | null
  >(null)
  const pendingTabRef = useRef<typeof activeTab>(null)

  // Apply pending tab after terminal becomes active
  useEffect(() => {
    if (isActive && pendingTabRef.current) {
      _setActiveTab(pendingTabRef.current)
      pendingTabRef.current = null
    }
  }, [isActive])

  const setActiveTab = (v: typeof activeTab) => {
    if (!isActive) {
      pendingTabRef.current = v
      selectTerminal(terminal.id)
      return
    }
    _setActiveTab((o) => (o === v ? null : v))
  }
  const [sessionsListExpanded, setSessionsListExpanded] = useState(true)
  const [showAllSessions, setShowAllSessions] = useState(false)
  const isSettingUp =
    terminal.git_repo?.status === 'setup' || terminal.setup?.status === 'setup'
  const isDeleting = terminal.setup?.status === 'delete'
  const displayName = terminal.name || terminal.cwd || 'Untitled'
  const hasSessions = sessions.length > 0
  const hasProcesses =
    terminal.shells.some((s) => !!s.active_cmd) || processes.length > 0
  const hasPorts = ports.length > 0

  const gitBranch = terminal.git_branch

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isSettingUp && !isDeleting) {
      onToggleTerminalSessions?.(terminal.id)
    }
  }

  const handleActionsClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(
      new CustomEvent('open-item-actions', {
        detail: {
          terminalId: terminal.id,
          sessionId: null,
        },
      }),
    )
  }

  const prInfo = useMemo(() => {
    return getPRStatusInfo(prForBranch)
  }, [prForBranch])

  return (
    <div data-terminal-id={terminal.id}>
      <div
        onClick={() => {
          selectTerminal(terminal.id)
          clearSession()
          if (!sessionsExpanded && !isSettingUp && !isDeleting) {
            onToggleTerminalSessions?.(terminal.id)
          }
        }}
        {...longPressHandlers}
        className={cn(
          `group flex relative gap-1 items-center pl-1 pr-2 py-1.5 transition-colors  ${`cursor-pointer ${
            isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
          }`} ${terminal.orphaned || isSettingUp || isDeleting ? 'opacity-60' : ''}`,
          ((!hasSessions &&
            (statusBarEnabled ||
              (!hasProcesses &&
                !hasGitHub &&
                !hasPorts &&
                !isDirty &&
                !showRemoteSync)) &&
            !showSidebarShells) ||
            isSettingUp ||
            isDeleting) &&
            'pl-2.5',
          hideFolder && 'rounded-l-lg',
        )}
      >
        {!isSettingUp &&
        !isDeleting &&
        (hasSessions ||
          (!statusBarEnabled &&
            (hasProcesses ||
              hasGitHub ||
              hasPorts ||
              isDirty ||
              showRemoteSync)) ||
          showSidebarShells) ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleChevronClick}
            className="h-6 w-6 flex-shrink-0"
          >
            {sessionsExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : prForBranch ? (
              prInfo.icon()
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        ) : (
          <div className={cn('h-4.5 w-4.5 flex-shrink-0')} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {terminal.ssh_host ? (
              <Globe className="w-4 h-4 flex-shrink-0 text-blue-400" />
            ) : terminal.orphaned ? (
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-yellow-500" />
            ) : (
              <TerminalIcon2
                className={cn(
                  'w-4 h-4 flex-shrink-0',
                  !hasProcesses &&
                    'fill-muted-foreground/60 group-hover:fill-muted-foreground',
                  !hasProcesses && isActive && 'fill-muted-foreground',
                  hasProcesses &&
                    !isActive &&
                    'fill-green-500/70 group-hover:fill-green-500',
                  hasProcesses && isActive && 'fill-green-500',
                )}
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
            <div className="flex items-center gap-1 text-[10px] text-blue-400">
              Preparing workspace...
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  cancelWorkspace(terminal.id).catch(() =>
                    toast.error('Failed to cancel'),
                  )
                }}
                className="flex items-center gap-1 text-red-400/60 hover:text-red-400 hover:bg-zinc-400/30 rounded-sm px-1 py-0.5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
          {terminal.git_repo?.status === 'done' && (
            <>
              {terminal.setup?.status === 'setup' && (
                <div className="flex items-center gap-1 text-[10px] text-blue-400">
                  Running setup...
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      cancelWorkspace(terminal.id).catch(() =>
                        toast.error('Failed to cancel'),
                      )
                    }}
                    className="flex items-center gap-1 text-red-400/60 hover:text-red-400 hover:bg-zinc-400/30 rounded-sm px-1 py-0.5 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {terminal.setup?.status === 'delete' && (
                <div className="flex items-center gap-1 text-[10px] text-blue-400">
                  Running teardown...
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      cancelWorkspace(terminal.id).catch(() =>
                        toast.error('Failed to cancel'),
                      )
                    }}
                    className="flex items-center gap-1 text-red-400/60 hover:text-red-400 hover:bg-zinc-400/30 rounded-sm px-1 py-0.5 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {gitBranch && terminal.setup?.status !== 'delete' && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <GitBranch
                className={cn('w-2.5 h-2.5 min-w-2.5 min-h-2.5 text-zinc-400')}
              />
              {gitBranch}
            </span>
          )}
        </div>
        {isTerminalPinned && !isGoToTabModifierHeld && (
          <Pin className="w-3 h-3 text-muted-foreground flex-shrink-0 group-hover:invisible" />
        )}
        {isGoToTabModifierHeld && shortcutIndex >= 1 ? (
          <span className="absolute right-1 bg-sidebar/80 rounded-md px-2 py-1 text-sm flex items-center gap-1 text-muted-foreground font-medium tabular-nums font-mono">
            {modifierIcons.goToTab('w-3 h-3')}
            {shortcutIndex}
          </span>
        ) : (
          !isSettingUp &&
          !isDeleting && (
            <button
              type="button"
              onClick={handleActionsClick}
              className={cn(
                'text-xs absolute right-1 text-muted-foreground flex-shrink-0 hover:text-foreground transition-colors cursor-pointer',
                isMobile ? 'block' : 'hidden group-hover:block',
              )}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          )
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
      {showSidebarShells && !isSettingUp && !isDeleting && sessionsExpanded && (
        <div className="px-1 pt-1">
          <ShellTabs
            terminal={terminal}
            activeShellId={sidebarActiveShellId}
            isActiveTerminal={isActive}
            onSelectShell={(shellId) => {
              setSidebarActiveShellId(shellId)
              selectTerminal(terminal.id)
              window.dispatchEvent(
                new CustomEvent('shell-select', {
                  detail: { terminalId: terminal.id, shellId },
                }),
              )
            }}
            onCreateShell={() => {
              selectTerminal(terminal.id)
              window.dispatchEvent(
                new CustomEvent('shell-create', {
                  detail: { terminalId: terminal.id },
                }),
              )
            }}
            onRenameShell={async (shellId, name) => {
              window.dispatchEvent(
                new CustomEvent('shell-rename', {
                  detail: { shellId, name },
                }),
              )
            }}
          />
        </div>
      )}
      {!isSettingUp &&
        !isDeleting &&
        ((!statusBarEnabled &&
          (hasGitHub ||
            hasProcesses ||
            hasPorts ||
            isDirty ||
            showRemoteSync)) ||
          hasSessions) &&
        sessionsExpanded && (
          <div className="space-y-0.5">
            {!statusBarEnabled &&
              (hasGitHub ||
                hasProcesses ||
                hasPorts ||
                isDirty ||
                showRemoteSync) && (
                <>
                  <div className="flex items-center px-2 pl-1 pt-1 flex-wrap">
                    {hasGitHub && prForBranch && (
                      <PRTabButton
                        pr={prForBranch}
                        withIcon
                        active={activeTab === 'prs' && isActive}
                        className={cn('whitespace-nowrap')}
                        hasNewActivity={prForBranch.hasUnreadNotifications}
                        onClick={() => {
                          setActiveTab('prs')
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
                      <button
                        type="button"
                        className={cn(
                          'text-[10px] opacity-60 tracking-wider px-1.5 py-0.5 rounded cursor-pointer hover:opacity-100 transition-opacity',
                          isActive && 'opacity-80',
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          window.dispatchEvent(
                            new CustomEvent('open-commit-dialog', {
                              detail: { terminalId: terminal.id },
                            }),
                          )
                        }}
                      >
                        <GitDirtyBadge
                          added={diffStat.added}
                          removed={diffStat.removed}
                          untracked={diffStat.untracked}
                        />
                      </button>
                    )}
                    {showRemoteSync && remoteSyncStat && (
                      <span
                        className={cn(
                          'text-[10px] opacity-60 tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 font-mono',
                          isActive && 'opacity-80',
                        )}
                      >
                        {remoteSyncStat.noRemote ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex gap-0 group/norem">
                                <ArrowDown className="w-3 h-3 text-yellow-500/80 group-hover/norem:text-yellow-500" />
                                <ArrowUp className="w-3 h-3 text-yellow-500/80 group-hover/norem:text-yellow-500 translate-x-[-3px]" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              No remote configured
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <>
                            {remoteSyncStat.behind > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="flex items-center text-blue-500/80 hover:text-blue-500">
                                    {remoteSyncStat.behind}
                                    <ArrowDown className="w-3 h-3" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {remoteSyncStat.behind} commit
                                  {remoteSyncStat.behind > 1 ? 's' : ''} behind
                                  remote
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {remoteSyncStat.ahead > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="flex items-center text-green-500/80 hover:text-green-500">
                                    {remoteSyncStat.ahead}
                                    <ArrowUp className="w-3 h-3" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {remoteSyncStat.ahead} commit
                                  {remoteSyncStat.ahead > 1 ? 's' : ''} ahead of
                                  remote
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="ml-1">
                    {activeTab === 'processes' && hasProcesses && (
                      <ProcessesList
                        processes={processes}
                        shells={terminal.shells}
                        terminalId={terminal.id}
                        terminalName={terminal.name}
                      />
                    )}
                    {activeTab === 'ports' && hasPorts && (
                      <PortsList
                        shellPorts={shellPorts}
                        terminalPorts={ports}
                        shells={terminal.shells}
                        terminalName={terminal.name}
                      />
                    )}
                    {activeTab === 'prs' && hasGitHub && prForBranch && (
                      <div className={cn(isActive && 'mt-1')}>
                        <PRStatusContent
                          pr={prForBranch}
                          expanded={true}
                          hasNewActivity={prForBranch.hasUnreadNotifications}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            {sessions.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSessionsListExpanded(!sessionsListExpanded)}
                  className="flex cursor-pointer w-full items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 pt-1"
                >
                  <ChevronDown
                    className={cn(
                      'w-3 h-3 transition-transform',
                      !sessionsListExpanded && '-rotate-90',
                    )}
                  />
                  Claude ({sessions.length})
                </button>
                {sessionsListExpanded &&
                  (() => {
                    const activeSessions = sessions.filter(
                      (s) =>
                        s.status === 'active' ||
                        s.status === 'permission_needed',
                    )
                    const visibleSessions =
                      activeSessions.length > 1
                        ? activeSessions
                        : sessions.slice(0, 1)
                    const hiddenSessions = sessions.filter(
                      (s) => !visibleSessions.includes(s),
                    )
                    return (
                      <>
                        {visibleSessions.map((session, idx) => (
                          <SessionItem
                            defaultCollapsed={idx > 0}
                            key={session.session_id}
                            session={session}
                          />
                        ))}
                        {hiddenSessions.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setShowAllSessions(!showAllSessions)
                              }
                              className="flex cursor-pointer w-full items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-2"
                            >
                              <ChevronDown
                                className={cn(
                                  'size-3 text-zinc-400 transition-transform duration-150',
                                  !showAllSessions && '-rotate-90',
                                )}
                              />
                              {showAllSessions
                                ? 'Hide older'
                                : `Show ${hiddenSessions.length} older`}
                            </button>
                            {showAllSessions &&
                              hiddenSessions.map((session) => (
                                <SessionItem
                                  defaultCollapsed
                                  key={session.session_id}
                                  session={session}
                                />
                              ))}
                          </>
                        )}
                      </>
                    )
                  })()}
              </>
            )}
          </div>
        )}
    </div>
  )
})
