import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  BellRing,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Globe,
  Link,
  MoreVertical,
  Pin,
  X,
} from 'lucide-react'
import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import { useSocket } from '@/hooks/useSocket'
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

const CommitDialog = lazy(() =>
  import('./CommitDialog').then((m) => ({ default: m.CommitDialog })),
)

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
  const { emit } = useSocket()
  const { isGoToTabModifierHeld, modifierIcons } = useModifiersHeld()
  const shortcutIndex =
    shortcutIndexProp ?? terminals.findIndex((t) => t.id === terminal.id) + 1
  const { githubPRs } = useTerminalContext()
  const {
    processes: allProcesses,
    terminalPorts,
    shellPorts,
    gitDirtyStatus,
    gitRemoteSyncStatus,
    subscribeToBell,
    unsubscribeFromBell,
    isBellSubscribed,
  } = useProcessContext()
  const processes = useMemo(
    () => allProcesses.filter((p) => p.terminalId === terminal.id),
    [allProcesses, terminal.id],
  )
  const ports = terminalPorts[terminal.id] ?? []
  const [collapsedShells, setCollapsedShells] = useState<Set<number>>(new Set())
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
  const [commitOpen, setCommitOpen] = useState(false)
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
    const resetHandler = (e: CustomEvent<{ terminalId: number }>) => {
      if (e.detail.terminalId === terminal.id && mainShell) {
        setSidebarActiveShellId(mainShell.id)
      }
    }
    window.addEventListener('shell-select', handler as EventListener)
    window.addEventListener('shell-reset', resetHandler as EventListener)
    return () => {
      window.removeEventListener('shell-select', handler as EventListener)
      window.removeEventListener('shell-reset', resetHandler as EventListener)
    }
  }, [terminal.id, mainShell?.id])

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
  const hasProcesses = processes.length > 0
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
          // Reset to main shell when clicking terminal item
          window.dispatchEvent(
            new CustomEvent('shell-reset', {
              detail: { terminalId: terminal.id },
            }),
          )
          if (mainShell) setSidebarActiveShellId(mainShell.id)
          if (!sessionsExpanded && !isSettingUp && !isDeleting) {
            onToggleTerminalSessions?.(terminal.id)
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
            !isDirty &&
            !showRemoteSync &&
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
          hasProcesses ||
          hasGitHub ||
          hasPorts ||
          isDirty ||
          showRemoteSync ||
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
              className="text-xs absolute right-1 text-muted-foreground hidden group-hover:block flex-shrink-0 hover:text-foreground transition-colors cursor-pointer"
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
        <div className="ml-2 px-1 pt-1">
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
            onDeleteShell={(shellId) => {
              window.dispatchEvent(
                new CustomEvent('shell-delete', {
                  detail: { terminalId: terminal.id, shellId },
                }),
              )
            }}
          />
        </div>
      )}
      {!isSettingUp &&
        !isDeleting &&
        (hasGitHub ||
          hasProcesses ||
          hasPorts ||
          isDirty ||
          showRemoteSync ||
          hasSessions) &&
        sessionsExpanded && (
          <div className="ml-2 space-y-0.5">
            {(hasGitHub ||
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
                      <span className="flex items-center gap-1">
                        {processes.some(
                          (p) =>
                            p.pid > 0 &&
                            p.terminalId !== undefined &&
                            isBellSubscribed(p.terminalId, p.pid),
                        ) && (
                          <BellRing className="w-2.5 h-2.5 text-yellow-400" />
                        )}
                        Processes ({processes.length})
                      </span>
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
                        'text-[10px] opacity-60 tracking-wider px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-100 transition-opacity',
                        isActive && 'opacity-80',
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        setCommitOpen(true)
                      }}
                    >
                      {diffStat.added > 0 && (
                        <span className="text-green-500/80">
                          +{diffStat.added}
                        </span>
                      )}
                      {diffStat.added > 0 && diffStat.removed > 0 && '/'}
                      {diffStat.removed > 0 && (
                        <span className="text-red-400/80">
                          -{diffStat.removed}
                        </span>
                      )}
                      {diffStat.untracked > 0 &&
                        (diffStat.added > 0 || diffStat.removed > 0) &&
                        '/'}
                      {diffStat.untracked > 0 && (
                        <span className="text-yellow-500/80">
                          ?{diffStat.untracked}
                        </span>
                      )}
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
                          <TooltipContent>No remote configured</TooltipContent>
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
                <div>
                  {activeTab === 'processes' &&
                    hasProcesses &&
                    (() => {
                      const grouped = new Map<number, typeof processes>()
                      for (const p of processes) {
                        const sid = p.shellId ?? 0
                        const arr = grouped.get(sid)
                        if (arr) arr.push(p)
                        else grouped.set(sid, [p])
                      }
                      const shellEntries = terminal.shells
                        .filter((s) => grouped.has(s.id))
                        .map((s) => ({ shell: s, procs: grouped.get(s.id)! }))
                      // Include ungrouped processes (shellId=0 or unknown)
                      const ungrouped = grouped.get(0)
                      return (
                        <>
                          {shellEntries.map(({ shell: sh, procs }) => {
                            const isCollapsed = collapsedShells.has(sh.id)
                            return (
                              <div key={sh.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedShells((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(sh.id)) next.delete(sh.id)
                                      else next.add(sh.id)
                                      return next
                                    })
                                  }
                                  className="flex cursor-pointer w-full items-center gap-1 text-[10px] tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 pt-1"
                                >
                                  <ChevronDown
                                    className={cn(
                                      'w-3 h-3 transition-transform',
                                      isCollapsed && '-rotate-90',
                                    )}
                                  />
                                  {sh.name} ({procs.length})
                                </button>
                                {!isCollapsed &&
                                  procs.map((process) => {
                                    const subscribed =
                                      process.pid > 0 &&
                                      process.terminalId !== undefined &&
                                      isBellSubscribed(
                                        process.terminalId,
                                        process.pid,
                                      )
                                    return (
                                      <div
                                        key={`${process.pid}-${process.command}`}
                                        className="group/proc flex items-center gap-2 px-2 py-1 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-sidebar-accent/30 transition-colors"
                                      >
                                        <Activity className="w-3 h-3 flex-shrink-0 text-green-500/70" />
                                        <span className="text-xs truncate w-fit">
                                          {process.command}
                                        </span>
                                        <span className="flex-shrink-0 ml-auto flex items-center gap-0.5">
                                          {process.pid > 0 && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                if (subscribed) {
                                                  unsubscribeFromBell(
                                                    terminal.id,
                                                    process.pid,
                                                  )
                                                  toast(
                                                    'Unsubscribed from process',
                                                  )
                                                } else {
                                                  subscribeToBell(
                                                    process,
                                                    displayName,
                                                  )
                                                  toast(
                                                    'Subscribed — will notify when done',
                                                  )
                                                }
                                              }}
                                              className={cn(
                                                'transition-colors cursor-pointer',
                                                subscribed
                                                  ? 'text-yellow-400'
                                                  : 'text-muted-foreground/60 hover:text-foreground/90 hidden group-hover/proc:text-muted-foreground/80 group-hover/proc:block',
                                              )}
                                            >
                                              {subscribed ? (
                                                <BellRing className="w-3 h-3" />
                                              ) : (
                                                <Bell className="w-3 h-3" />
                                              )}
                                            </button>
                                          )}
                                          {process.isZellij && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                emit('zellij-attach', {
                                                  terminalId: terminal.id,
                                                })
                                              }}
                                              className="hidden group-hover/proc:block text-muted-foreground/60 hover:text-foreground/90 group-hover/proc:text-muted-foreground/80 transition-colors cursor-pointer"
                                            >
                                              <Link className="w-3 h-3" />
                                            </button>
                                          )}
                                          {process.pid > 0 && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                emit('kill-process', {
                                                  pid: process.pid,
                                                })
                                                toast('Process killed')
                                              }}
                                              className="hidden group-hover/proc:block text-muted-foreground/60 group-hover/proc:text-muted-foreground/80 hover:text-red-400/90 transition-colors cursor-pointer"
                                            >
                                              <X className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </span>
                                      </div>
                                    )
                                  })}
                              </div>
                            )
                          })}
                          {ungrouped?.map((process) => (
                            <div
                              key={`${process.pid}-${process.command}`}
                              className="group/proc flex items-center gap-2 px-2 py-1 rounded text-sidebar-foreground/70"
                            >
                              <Activity className="w-3 h-3 flex-shrink-0 text-green-500" />
                              <span className="text-xs truncate w-fit">
                                {process.command}
                              </span>
                            </div>
                          ))}
                        </>
                      )
                    })()}
                  {activeTab === 'ports' &&
                    hasPorts &&
                    (() => {
                      // Group ports by shell using shellPorts
                      const shellEntries = terminal.shells
                        .filter((s) => shellPorts[s.id]?.length > 0)
                        .map((s) => ({
                          shell: s,
                          ports: shellPorts[s.id],
                        }))
                      const hasShellGrouping = shellEntries.length > 0
                      if (!hasShellGrouping) {
                        // Fallback: flat list (no shell-level data)
                        return ports.map((port) => (
                          <a
                            key={port}
                            href={`http://localhost:${port}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center group/port gap-2 px-2 py-1 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                          >
                            <Globe className="w-3 h-3 flex-shrink-0 text-blue-400" />
                            <span className="text-xs">{port}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0 hidden group-hover/port:block ml-auto" />
                          </a>
                        ))
                      }
                      return shellEntries.map(
                        ({ shell: sh, ports: sPorts }) => {
                          const isCollapsed = collapsedShells.has(sh.id)
                          return (
                            <div key={sh.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedShells((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(sh.id)) next.delete(sh.id)
                                    else next.add(sh.id)
                                    return next
                                  })
                                }
                                className="flex cursor-pointer w-full items-center gap-1 text-[10px] tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 pt-1"
                              >
                                <ChevronDown
                                  className={cn(
                                    'w-3 h-3 transition-transform',
                                    isCollapsed && '-rotate-90',
                                  )}
                                />
                                {sh.name} ({sPorts.length})
                              </button>
                              {!isCollapsed &&
                                sPorts.map((port) => (
                                  <a
                                    key={port}
                                    href={`http://localhost:${port}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center group/port gap-2 px-2 ml-2 py-1 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                                  >
                                    <Globe className="w-3 h-3 flex-shrink-0 text-blue-400" />
                                    <span className="text-xs">{port}</span>
                                    <ExternalLink className="w-3 h-3 flex-shrink-0 hidden group-hover/port:block ml-auto" />
                                  </a>
                                ))}
                            </div>
                          )
                        },
                      )
                    })()}
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
                              {showAllSessions ? (
                                <>
                                  <ChevronUp className="w-3 h-3" />
                                  Hide older
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="w-3 h-3" />
                                  Show {hiddenSessions.length} older
                                </>
                              )}
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
      {commitOpen && (
        <Suspense>
          <CommitDialog
            open={commitOpen}
            terminalId={terminal.id}
            onClose={() => setCommitOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
})
