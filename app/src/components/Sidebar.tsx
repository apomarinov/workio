import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  Folder,
  Globe,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTerminalContext } from '../context/TerminalContext'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { SessionWithProject, Terminal } from '../types'
import { CreateSSHTerminalModal } from './CreateSSHTerminalModal'
import { CreateTerminalModal } from './CreateTerminalModal'
import { FolderGroup } from './FolderGroup'
import { PRStatusGroup } from './PRStatusGroup'
import { SessionGroup } from './SessionGroup'
import { SessionItem } from './SessionItem'
import { SettingsModal } from './SettingsModal'
import { SortableTerminalItem } from './SortableTerminalItem'

type GroupingMode = 'all' | 'folder' | 'sessions'

interface SidebarProps {
  width?: number
}

export function Sidebar({ width }: SidebarProps) {
  const { terminals, selectTerminal, setTerminalOrder } = useTerminalContext()
  const { sessions } = useClaudeSessions()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSSHModal, setShowSSHModal] = useState(false)
  const [createPopoverOpen, setCreatePopoverOpen] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [groupingOpen, setGroupingOpen] = useState(false)
  const [groupingMode, setGroupingMode] = useLocalStorage<GroupingMode>(
    'sidebar-grouping',
    'all',
  )
  const [expandedFoldersArray, setExpandedFoldersArray] = useLocalStorage<
    string[]
  >('sidebar-expanded-folders', [])
  const [expandedSessionGroups, setExpandedSessionGroups] = useLocalStorage<
    string[]
  >('sidebar-expanded-session-groups', [])
  const [expandedTerminalSessions, setExpandedTerminalSessions] =
    useLocalStorage<number[]>('sidebar-expanded-terminal-sessions', [])
  const [collapsedTerminalProcesses, setCollapsedTerminalProcesses] =
    useLocalStorage<number[]>('sidebar-collapsed-terminal-processes', [])
  const [, setCollapsedSessions] = useLocalStorage<string[]>(
    'sidebar-collapsed-sessions',
    [],
  )
  const [collapsedTerminalGitHub, setCollapsedTerminalGitHub] = useLocalStorage<
    number[]
  >('sidebar-collapsed-terminal-github', [])
  const [terminalsSectionCollapsed, setTerminalsSectionCollapsed] =
    useLocalStorage<boolean>('sidebar-section-terminals-collapsed', false)
  const [githubSectionCollapsed, setGithubSectionCollapsed] =
    useLocalStorage<boolean>('sidebar-section-github-collapsed', false)
  const [collapsedGitHubRepos, setCollapsedGitHubRepos] = useLocalStorage<
    string[]
  >('sidebar-collapsed-github-repos', [])
  const [otherSessionsSectionCollapsed, setOtherSessionsSectionCollapsed] =
    useLocalStorage<boolean>('sidebar-section-other-sessions-collapsed', false)
  const {
    githubPRs,
    hasNewActivity,
    markPRSeen,
    markAllPRsSeen,
    hasAnyUnseenPRs,
  } = useTerminalContext()
  const [bellOpen, setBellOpen] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const ids = terminals.map((t) => t.id)
      const oldIndex = ids.indexOf(active.id as number)
      const newIndex = ids.indexOf(over.id as number)
      if (oldIndex === -1 || newIndex === -1) return

      const newIds = [...ids]
      newIds.splice(oldIndex, 1)
      newIds.splice(newIndex, 0, active.id as number)
      setTerminalOrder(newIds)
    },
    [terminals, setTerminalOrder],
  )

  const expandedFolders = useMemo(
    () => new Set(expandedFoldersArray),
    [expandedFoldersArray],
  )

  const groupedTerminals = useMemo(() => {
    const groups = new Map<string, Terminal[]>()
    for (const terminal of terminals) {
      const existing = groups.get(terminal.cwd) || []
      existing.push(terminal)
      groups.set(terminal.cwd, existing)
    }
    return groups
  }, [terminals])

  // Compute session assignments:
  // - sessionsForTerminal: sessions with terminal_id matching an existing terminal
  // - orphanSessionGroups: sessions with no matching terminal_id, grouped by project_path
  const { sessionsForTerminal, orphanSessionGroups } = useMemo(() => {
    const terminalIds = new Set(terminals.map((t) => t.id))
    const sessionsForTerminal = new Map<number, SessionWithProject[]>()
    const orphanGroups = new Map<string, SessionWithProject[]>()

    for (const session of sessions) {
      if (session.terminal_id && terminalIds.has(session.terminal_id)) {
        // Session has a terminal_id that matches an existing terminal
        const existing = sessionsForTerminal.get(session.terminal_id) || []
        existing.push(session)
        sessionsForTerminal.set(session.terminal_id, existing)
      } else {
        // Orphan session - no matching terminal_id, group by project_path
        const existing = orphanGroups.get(session.project_path) || []
        existing.push(session)
        orphanGroups.set(session.project_path, existing)
      }
    }

    return {
      sessionsForTerminal,
      orphanSessionGroups: orphanGroups,
    }
  }, [sessions, terminals])

  const allFolders = useMemo(
    () => Array.from(groupedTerminals.keys()),
    [groupedTerminals],
  )

  const toggleFolder = (cwd: string) => {
    setExpandedFoldersArray((prev) => {
      if (prev.includes(cwd)) {
        return prev.filter((f) => f !== cwd)
      }
      return [...prev, cwd]
    })
  }

  const toggleSessionGroup = (path: string) => {
    setExpandedSessionGroups((prev) => {
      if (prev.includes(path)) {
        return prev.filter((p) => p !== path)
      }
      return [...prev, path]
    })
  }

  const expandedSessionGroupsSet = useMemo(
    () => new Set(expandedSessionGroups),
    [expandedSessionGroups],
  )

  const expandedTerminalSessionsSet = useMemo(
    () => new Set(expandedTerminalSessions),
    [expandedTerminalSessions],
  )

  const toggleTerminalSessions = (terminalId: number) => {
    setExpandedTerminalSessions((prev) => {
      if (prev.includes(terminalId)) {
        return prev.filter((id) => id !== terminalId)
      }
      return [...prev, terminalId]
    })
  }

  const collapsedTerminalProcessesSet = useMemo(
    () => new Set(collapsedTerminalProcesses),
    [collapsedTerminalProcesses],
  )

  const toggleTerminalProcesses = (terminalId: number) => {
    setCollapsedTerminalProcesses((prev) => {
      if (prev.includes(terminalId)) {
        return prev.filter((id) => id !== terminalId)
      }
      return [...prev, terminalId]
    })
  }

  const collapsedTerminalGitHubSet = useMemo(
    () => new Set(collapsedTerminalGitHub),
    [collapsedTerminalGitHub],
  )

  const toggleTerminalGitHub = (terminalId: number) => {
    setCollapsedTerminalGitHub((prev) => {
      if (prev.includes(terminalId)) {
        return prev.filter((id) => id !== terminalId)
      }
      return [...prev, terminalId]
    })
  }

  // Track expanded state for individual PRs in the sidebar GitHub section
  const [expandedGitHubPRs, setExpandedGitHubPRs] = useLocalStorage<string[]>(
    'sidebar-expanded-github-prs',
    [],
  )

  const expandedGitHubPRsSet = useMemo(
    () => new Set(expandedGitHubPRs),
    [expandedGitHubPRs],
  )

  const toggleGitHubPR = (branch: string) => {
    setExpandedGitHubPRs((prev) => {
      if (prev.includes(branch)) {
        return prev.filter((b) => b !== branch)
      }
      return [...prev, branch]
    })
  }

  const collapsedGitHubReposSet = useMemo(
    () => new Set(collapsedGitHubRepos),
    [collapsedGitHubRepos],
  )

  const toggleGitHubRepo = (repo: string) => {
    setCollapsedGitHubRepos((prev) =>
      prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo],
    )
  }

  const githubPRsByRepo = useMemo(() => {
    const grouped = new Map<string, typeof githubPRs>()
    for (const pr of githubPRs) {
      const existing = grouped.get(pr.repo)
      if (existing) {
        existing.push(pr)
      } else {
        grouped.set(pr.repo, [pr])
      }
    }
    return grouped
  }, [githubPRs])

  const allGitHubRepos = useMemo(
    () => Array.from(githubPRsByRepo.keys()),
    [githubPRsByRepo],
  )

  const allSessionIds = useMemo(
    () => sessions.map((s) => s.session_id),
    [sessions],
  )

  const allTerminalIds = useMemo(() => terminals.map((t) => t.id), [terminals])

  const allOrphanGroupPaths = useMemo(
    () => Array.from(orphanSessionGroups.keys()),
    [orphanSessionGroups],
  )

  const expandAll = () => {
    setExpandedFoldersArray(allFolders)
    setExpandedSessionGroups(allOrphanGroupPaths)
    setExpandedTerminalSessions(allTerminalIds)
    setCollapsedTerminalProcesses([])
    setCollapsedTerminalGitHub([])
    setCollapsedSessions([])
    setTerminalsSectionCollapsed(false)
    setOtherSessionsSectionCollapsed(false)
    setGithubSectionCollapsed(false)
    setCollapsedGitHubRepos([])
    setExpandedGitHubPRs(githubPRs.map((pr) => pr.branch))
  }

  const collapseAll = () => {
    setExpandedFoldersArray([])
    setExpandedSessionGroups([])
    setExpandedTerminalSessions([])
    setCollapsedTerminalProcesses(allTerminalIds)
    setCollapsedTerminalGitHub(allTerminalIds)
    setCollapsedSessions(allSessionIds)
    setTerminalsSectionCollapsed(true)
    setOtherSessionsSectionCollapsed(true)
    setGithubSectionCollapsed(true)
    setCollapsedGitHubRepos(allGitHubRepos)
    setExpandedGitHubPRs([])
  }

  const allExpanded =
    allFolders.every((f) => expandedFolders.has(f)) &&
    allOrphanGroupPaths.every((p) => expandedSessionGroupsSet.has(p)) &&
    allTerminalIds.every((id) => expandedTerminalSessionsSet.has(id)) &&
    !terminalsSectionCollapsed &&
    !otherSessionsSectionCollapsed &&
    !githubSectionCollapsed &&
    allGitHubRepos.every((r) => !collapsedGitHubReposSet.has(r))

  return (
    <div
      className="h-full bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden"
      style={width ? { width: `${width}px` } : undefined}
    >
      <div className="px-4 py-4 border-b border-sidebar-border flex items-center justify-between">
        <div className="text-sm flex items-center gap-2">
          <Popover open={createPopoverOpen} onOpenChange={setCreatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="New Terminal"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1 space-y-1" align="start">
              <button
                onClick={() => {
                  setCreatePopoverOpen(false)
                  setShowCreateModal(true)
                }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
              >
                <TerminalIcon className="w-4 h-4" />
                Terminal
              </button>
              <button
                onClick={() => {
                  setCreatePopoverOpen(false)
                  setShowSSHModal(true)
                }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
              >
                <Globe className="w-4 h-4" />
                SSH
              </button>
            </PopoverContent>
          </Popover>
        </div>
        {width !== undefined && width < 220 ? (
          <div className="flex items-center gap-1">
            {hasAnyUnseenPRs && (
              <Popover open={bellOpen} onOpenChange={setBellOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 relative"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-1" align="end">
                  <button
                    onClick={() => {
                      markAllPRsSeen()
                      setBellOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                  >
                    Mark all as read
                  </button>
                </PopoverContent>
              </Popover>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="More options"
                >
                  <Ellipsis className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1 space-y-1" align="end">
                <Popover open={groupingOpen} onOpenChange={setGroupingOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer">
                      <LayoutList className="w-4 h-4" />
                      Grouping
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-40 p-1 space-y-1"
                    side="right"
                    align="start"
                  >
                    <button
                      onClick={() => {
                        setGroupingMode('all')
                        setGroupingOpen(false)
                      }}
                      className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${groupingMode === 'all' ? 'bg-accent' : ''
                        }`}
                    >
                      <TerminalIcon className="w-4 h-4" />
                      Terminals
                    </button>
                    <button
                      onClick={() => {
                        setGroupingMode('sessions')
                        setGroupingOpen(false)
                      }}
                      className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${groupingMode === 'sessions' ? 'bg-accent' : ''
                        }`}
                    >
                      <Bot className="w-4 h-4" />
                      Claude
                    </button>
                    <button
                      onClick={() => {
                        setGroupingMode('folder')
                        setGroupingOpen(false)
                      }}
                      className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${groupingMode === 'folder' ? 'bg-accent' : ''
                        }`}
                    >
                      <Folder className="w-4 h-4" />
                      Folders
                    </button>
                  </PopoverContent>
                </Popover>
                <button
                  onClick={allExpanded ? collapseAll : expandAll}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                >
                  {allExpanded ? (
                    <ChevronsDownUp className="w-4 h-4" />
                  ) : (
                    <ChevronsUpDown className="w-4 h-4" />
                  )}
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Popover open={groupingOpen} onOpenChange={setGroupingOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Grouping"
                >
                  <LayoutList className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1 space-y-1" align="start">
                <button
                  onClick={() => {
                    setGroupingMode('all')
                    setGroupingOpen(false)
                  }}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${groupingMode === 'all' ? 'bg-accent' : ''
                    }`}
                >
                  <TerminalIcon className="w-4 h-4" />
                  Terminals
                </button>
                <button
                  onClick={() => {
                    setGroupingMode('sessions')
                    setGroupingOpen(false)
                  }}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${groupingMode === 'sessions' ? 'bg-accent' : ''
                    }`}
                >
                  <Bot className="w-4 h-4" />
                  Claude
                </button>
                <button
                  onClick={() => {
                    setGroupingMode('folder')
                    setGroupingOpen(false)
                  }}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${groupingMode === 'folder' ? 'bg-accent' : ''
                    }`}
                >
                  <Folder className="w-4 h-4" />
                  Folders
                </button>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={allExpanded ? collapseAll : expandAll}
              title={allExpanded ? 'Collapse all' : 'Expand all'}
            >
              {allExpanded ? (
                <ChevronsDownUp className="w-4 h-4" />
              ) : (
                <ChevronsUpDown className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowSettingsModal(true)}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
            {hasAnyUnseenPRs && (
              <Popover open={bellOpen} onOpenChange={setBellOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 relative"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-1" align="end">
                  <button
                    onClick={() => {
                      markAllPRsSeen()
                      setBellOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                  >
                    Mark all as read
                  </button>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-0 space-y-1 @container/sidebar">
        {groupingMode === 'sessions' ? (
          sessions.map((session) => (
            <SessionItem
              key={session.session_id}
              session={session}
              showGitBranch
            />
          ))
        ) : (
          <>
            {terminals.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setTerminalsSectionCollapsed(!terminalsSectionCollapsed)
                  }
                  className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pt-2 hover:text-muted-foreground transition-colors w-full"
                >
                  {terminalsSectionCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  Terminals
                </button>
                {!terminalsSectionCollapsed &&
                  (groupingMode === 'folder' ? (
                    Array.from(groupedTerminals.entries()).map(
                      ([folderCwd, folderTerminals]) => (
                        <FolderGroup
                          key={folderCwd}
                          cwd={folderCwd}
                          terminals={folderTerminals}
                          expanded={expandedFolders.has(folderCwd)}
                          onToggle={() => toggleFolder(folderCwd)}
                          sessionsForTerminal={sessionsForTerminal}
                          expandedTerminalSessions={expandedTerminalSessionsSet}
                          onToggleTerminalSessions={toggleTerminalSessions}
                          collapsedTerminalProcesses={
                            collapsedTerminalProcessesSet
                          }
                          onToggleTerminalProcesses={toggleTerminalProcesses}
                          collapsedTerminalGitHub={collapsedTerminalGitHubSet}
                          onToggleTerminalGitHub={toggleTerminalGitHub}
                        />
                      ),
                    )
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[
                        restrictToVerticalAxis,
                        restrictToParentElement,
                      ]}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={terminals.map((t) => t.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {terminals.map((terminal) => (
                          <SortableTerminalItem
                            key={terminal.id}
                            terminal={terminal}
                            sessions={
                              sessionsForTerminal.get(terminal.id) || []
                            }
                            sessionsExpanded={expandedTerminalSessionsSet.has(
                              terminal.id,
                            )}
                            onToggleSessions={() =>
                              toggleTerminalSessions(terminal.id)
                            }
                            processesExpanded={
                              !collapsedTerminalProcessesSet.has(terminal.id)
                            }
                            onToggleProcesses={() =>
                              toggleTerminalProcesses(terminal.id)
                            }
                            githubExpanded={
                              !collapsedTerminalGitHubSet.has(terminal.id)
                            }
                            onToggleGitHub={() =>
                              toggleTerminalGitHub(terminal.id)
                            }
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  ))}
              </>
            )}

            {/* GitHub PR status */}
            {githubPRs.length > 0 && (
              <>
                <div
                  className={cn(
                    'border-t border-sidebar-border my-2',
                    terminals.length === 0 &&
                    orphanSessionGroups.size === 0 &&
                    'border-none',
                  )}
                />
                <button
                  type="button"
                  onClick={() =>
                    setGithubSectionCollapsed(!githubSectionCollapsed)
                  }
                  className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 py-0 hover:text-muted-foreground transition-colors w-full"
                >
                  {githubSectionCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  Pull requests
                </button>
                {!githubSectionCollapsed &&
                  Array.from(githubPRsByRepo.entries()).map(
                    ([repo, repoPRs]) => {
                      const repoName = repo.split('/')[1] || repo
                      const isCollapsed = collapsedGitHubReposSet.has(repo)
                      return (
                        <div key={repo}>
                          <button
                            type="button"
                            onClick={() => toggleGitHubRepo(repo)}
                            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground/70 px-2 py-0.5 hover:text-muted-foreground transition-colors w-full"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-3 h-3 flex-shrink-0" />
                            ) : (
                              <ChevronDown className="w-3 h-3 flex-shrink-0" />
                            )}
                            <span className="truncate">{repoName}</span>
                          </button>
                          {!isCollapsed &&
                            repoPRs.map((pr) => (
                              <PRStatusGroup
                                key={`${pr.repo}:${pr.branch}`}
                                pr={pr}
                                expanded={expandedGitHubPRsSet.has(pr.branch)}
                                onToggle={() => toggleGitHubPR(pr.branch)}
                                hasNewActivity={hasNewActivity(pr)}
                                onSeen={() => markPRSeen(pr)}
                              />
                            ))}
                        </div>
                      )
                    },
                  )}
              </>
            )}
          </>
        )}

        {/* Orphan sessions - grouped by project path */}
        {orphanSessionGroups.size > 0 && (
          <>
            <div
              className={cn(
                'border-t border-sidebar-border my-2',
                terminals.length === 0 && 'border-none',
              )}
            />
            <button
              type="button"
              onClick={() =>
                setOtherSessionsSectionCollapsed(
                  !otherSessionsSectionCollapsed,
                )
              }
              className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 py-0 hover:text-muted-foreground transition-colors w-full"
            >
              {otherSessionsSectionCollapsed ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              Other Claude Sessions
            </button>
            {!otherSessionsSectionCollapsed &&
              Array.from(orphanSessionGroups.entries()).map(
                ([projectPath, groupSessions]) => (
                  <SessionGroup
                    key={projectPath}
                    projectPath={projectPath}
                    sessions={groupSessions}
                    expanded={expandedSessionGroupsSet.has(projectPath)}
                    onToggle={() => toggleSessionGroup(projectPath)}
                  />
                ),
              )}
          </>
        )}
      </div>

      <CreateTerminalModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={selectTerminal}
      />

      <CreateSSHTerminalModal
        open={showSSHModal}
        onOpenChange={setShowSSHModal}
        onCreated={selectTerminal}
      />

      <SettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
      />
    </div>
  )
}
