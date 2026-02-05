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
  Ellipsis,
  EyeOff,
  Folder,
  GitBranch,
  Github,
  GitMerge,
  LayoutList,
  Loader2,
  PictureInPicture2,
  Plus,
  Search,
  Settings,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import { useDocumentPip } from '../context/DocumentPipContext'
import { useSessionContext } from '../context/SessionContext'
import { useTerminalContext } from '../context/TerminalContext'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSettings } from '../hooks/useSettings'
import type { SessionWithProject, Terminal } from '../types'
import { CreateTerminalModal } from './CreateTerminalModal'
import { FolderGroup } from './FolderGroup'
import { LogsModal } from './LogsModal'
import { OlderMergedPRsList } from './MergedPRsList'
import { NotificationList } from './NotificationList'
import { getPipDimensions, usePinnedSessionsData } from './PinnedSessionsPip'
import { PRStatusGroup } from './PRStatusGroup'
import { SessionGroup } from './SessionGroup'
import { SessionItem } from './SessionItem'
import { SettingsModal } from './SettingsModal'
import { SortableRepoGroup } from './SortableRepoGroup'
import { SortableTerminalItem } from './SortableTerminalItem'
import { useWebhookWarning } from './WebhooksModal'

type GroupingMode = 'all' | 'folder' | 'sessions'

interface SidebarProps {
  width?: number
}

export function Sidebar({ width }: SidebarProps) {
  const pip = useDocumentPip()
  const { terminals, selectTerminal, setTerminalOrder } = useTerminalContext()
  const { clearSession, selectSession, sessions } = useSessionContext()
  const { allSessions: pipSessions } = usePinnedSessionsData()
  const [pipLayout] = useLocalStorage<'horizontal' | 'vertical'>(
    'pip-layout',
    'horizontal',
  )
  const hasAnySessions = pipSessions.length > 0
  const { hasWarning: hasWebhookWarning } = useWebhookWarning()
  const { settings, updateSettings } = useSettings()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [hiddenPRsModalRepo, setHiddenPRsModalRepo] = useState<string | null>(
    null,
  )
  const [removingPR, setRemovingPR] = useState<number | null>(null)
  const [removingAuthor, setRemovingAuthor] = useState<string | null>(null)
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
  const [collapsedSessions, setCollapsedSessions] = useLocalStorage<string[]>(
    'sidebar-collapsed-sessions',
    [],
  )
  const [terminalsSectionCollapsed, setTerminalsSectionCollapsed] =
    useLocalStorage<boolean>('sidebar-section-terminals-collapsed', false)
  const [githubSectionCollapsed, setGithubSectionCollapsed] =
    useLocalStorage<boolean>('sidebar-section-github-collapsed', false)
  const [collapsedGitHubRepos, setCollapsedGitHubRepos] = useLocalStorage<
    string[]
  >('sidebar-collapsed-github-repos', [])
  const [repoOrder, setRepoOrder] = useLocalStorage<string[]>(
    'sidebar-repo-order',
    [],
  )
  const [otherSessionsSectionCollapsed, setOtherSessionsSectionCollapsed] =
    useLocalStorage<boolean>('sidebar-section-other-sessions-collapsed', false)
  const {
    githubPRs,
    mergedPRs,
    hasNewActivity,
    markPRSeen,
    hasAnyUnseenPRs,
    hasNotifications,
    hasUnreadNotifications,
    activePR,
    setActivePR,
  } = useTerminalContext()
  const [bellOpen, setBellOpen] = useState(false)
  const [logsModal, setLogsModal] = useState<{
    open: boolean
    initialFilter?: { terminalId?: number; prName?: string }
  }>({ open: false })
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

  // Track expanded state for individual PRs in the sidebar GitHub section
  const [expandedGitHubPRs, setExpandedGitHubPRs] = useLocalStorage<string[]>(
    'sidebar-expanded-github-prs',
    [],
  )

  const expandedGitHubPRsSet = useMemo(
    () => new Set(expandedGitHubPRs),
    [expandedGitHubPRs],
  )

  const toggleGitHubPR = (pr: PRCheckStatus) => {
    const isExpanding = !expandedGitHubPRs.includes(pr.branch)
    setExpandedGitHubPRs((prev) => {
      if (prev.includes(pr.branch)) {
        return prev.filter((b) => b !== pr.branch)
      }
      return [...prev, pr.branch]
    })
    // Set activePR when expanding, clear when collapsing
    setActivePR(isExpanding ? pr : null)
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

  // Sort repos based on saved order
  const sortedRepos = useMemo(() => {
    const repos = Array.from(githubPRsByRepo.keys())
    return repos.sort((a, b) => {
      const aIndex = repoOrder.indexOf(a)
      const bIndex = repoOrder.indexOf(b)
      // If both are in order, sort by order
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
      // If only one is in order, it comes first
      if (aIndex !== -1) return -1
      if (bIndex !== -1) return 1
      // Neither in order, keep original order
      return 0
    })
  }, [githubPRsByRepo, repoOrder])

  const handleRepoDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = sortedRepos.indexOf(active.id as string)
      const newIndex = sortedRepos.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return

      const newOrder = [...sortedRepos]
      newOrder.splice(oldIndex, 1)
      newOrder.splice(newIndex, 0, active.id as string)
      setRepoOrder(newOrder)
    },
    [sortedRepos, setRepoOrder],
  )

  const mergedPRsByRepo = useMemo(() => {
    const grouped = new Map<string, typeof mergedPRs>()
    for (const pr of mergedPRs) {
      const existing = grouped.get(pr.repo)
      if (existing) {
        existing.push(pr)
      } else {
        grouped.set(pr.repo, [pr])
      }
    }
    return grouped
  }, [mergedPRs])

  const allSessionIds = useMemo(
    () => sessions.map((s) => s.session_id),
    [sessions],
  )

  const collapseAll = useCallback(() => {
    setExpandedFoldersArray([])
    setExpandedSessionGroups([])
    setExpandedTerminalSessions([])
    setCollapsedSessions(allSessionIds)
    setExpandedGitHubPRs([])
  }, [
    allSessionIds,
    setExpandedFoldersArray,
    setExpandedSessionGroups,
    setExpandedTerminalSessions,
    setCollapsedSessions,
    setExpandedGitHubPRs,
  ])

  const handlePipToggle = useCallback(() => {
    if (pip.isOpen) {
      pip.closeAll()
      return
    }
    if (pipSessions.length === 0) return

    const dims = getPipDimensions(pipLayout)
    pip.open({
      width: dims?.width ?? 400,
      height: dims?.height ?? 300,
      left: dims?.left,
      top: dims?.top,
      elementId: 'pinned-sessions-pip',
    })
  }, [pip, pipSessions.length, pipLayout])

  // Listen for toggle-pip events from keyboard shortcut
  useEffect(() => {
    const handler = () => handlePipToggle()
    window.addEventListener('toggle-pip', handler)
    return () => window.removeEventListener('toggle-pip', handler)
  }, [handlePipToggle])

  // Listen for collapse-all events from keyboard shortcut
  useEffect(() => {
    const handler = () => collapseAll()
    window.addEventListener('collapse-all', handler)
    return () => window.removeEventListener('collapse-all', handler)
  }, [collapseAll])

  // Listen for open-settings events from keyboard shortcut
  useEffect(() => {
    const handler = () => setShowSettingsModal(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  // Listen for open-logs events from command palette
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { terminalId?: number; prName?: string }
        | undefined
      setLogsModal({ open: true, initialFilter: detail })
    }
    window.addEventListener('open-logs', handler)
    return () => window.removeEventListener('open-logs', handler)
  }, [])

  // Listen for reveal-pr events from the command palette
  useEffect(() => {
    const handler = (e: Event) => {
      const { branch, repo } = (e as CustomEvent).detail as {
        branch: string
        repo: string
      }
      // Ensure the GitHub section, repo, and PR are all expanded
      setGithubSectionCollapsed(false)
      setCollapsedGitHubRepos((prev) => prev.filter((r) => r !== repo))
      setExpandedGitHubPRs((prev) =>
        prev.includes(branch) ? prev : [...prev, branch],
      )
      // Scroll to the PR and flash it after state updates flush
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-pr-branch="${branch}"]`)
        if (!el) return
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        const row = el.firstElementChild as HTMLElement | null
        if (row) {
          row.classList.add('animate-flash')
          setTimeout(() => row.classList.remove('animate-flash'), 2100)
        }
      })
    }
    window.addEventListener('reveal-pr', handler)
    return () => window.removeEventListener('reveal-pr', handler)
  }, [setGithubSectionCollapsed, setCollapsedGitHubRepos, setExpandedGitHubPRs])

  // Listen for reveal-terminal events from the command palette
  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent).detail as { id: number }
      const terminal = terminals.find((t) => t.id === id)
      if (!terminal) return

      // Expand the terminals section
      setTerminalsSectionCollapsed(false)

      // If in folder mode, expand the terminal's folder
      if (groupingMode === 'folder') {
        setExpandedFoldersArray((prev) =>
          prev.includes(terminal.cwd) ? prev : [...prev, terminal.cwd],
        )
      }

      // Expand the terminal itself
      setExpandedTerminalSessions((prev) =>
        prev.includes(id) ? prev : [...prev, id],
      )

      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-terminal-id="${id}"]`)
        if (!el) return
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        el.classList.add('animate-flash')
        setTimeout(() => el.classList.remove('animate-flash'), 2100)
      })
    }
    window.addEventListener('reveal-terminal', handler)
    return () => window.removeEventListener('reveal-terminal', handler)
  }, [
    terminals,
    groupingMode,
    setTerminalsSectionCollapsed,
    setExpandedFoldersArray,
    setExpandedTerminalSessions,
  ])

  // Listen for reveal-session events from the command palette
  useEffect(() => {
    const handler = (e: Event) => {
      window.focus()
      const { sessionId } = (e as CustomEvent).detail as { sessionId: string }
      const session = sessions.find((s) => s.session_id === sessionId)
      if (!session) return

      // Check if this session belongs to a terminal or is an orphan
      const parentTerminal = session.terminal_id
        ? terminals.find((t) => t.id === session.terminal_id)
        : undefined

      if (parentTerminal) {
        selectTerminal(parentTerminal.id)
        // Session is under a terminal - expand terminals section, folder, and terminal sessions
        setTerminalsSectionCollapsed(false)
        if (groupingMode === 'folder') {
          setExpandedFoldersArray((prev) =>
            prev.includes(parentTerminal.cwd)
              ? prev
              : [...prev, parentTerminal.cwd],
          )
        }
        setExpandedTerminalSessions((prev) =>
          prev.includes(parentTerminal.id)
            ? prev
            : [...prev, parentTerminal.id],
        )
      } else {
        selectSession(session.session_id)
        // Orphan session - expand the "other sessions" section and session group
        setOtherSessionsSectionCollapsed(false)
        setExpandedSessionGroups((prev) =>
          prev.includes(session.project_path)
            ? prev
            : [...prev, session.project_path],
        )
      }

      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-session-id="${sessionId}"]`)
        if (!el) return
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        window.dispatchEvent(
          new CustomEvent('flash-session', { detail: { sessionId } }),
        )
      })
    }
    window.addEventListener('reveal-session', handler)
    return () => window.removeEventListener('reveal-session', handler)
  }, [
    sessions,
    terminals,
    groupingMode,
    selectTerminal,
    selectSession,
    setTerminalsSectionCollapsed,
    setExpandedFoldersArray,
    setExpandedTerminalSessions,
    setOtherSessionsSectionCollapsed,
    setExpandedSessionGroups,
  ])

  const hasAnythingExpanded =
    expandedFoldersArray.length > 0 ||
    expandedSessionGroups.length > 0 ||
    expandedTerminalSessions.length > 0 ||
    collapsedSessions.length < allSessionIds.length ||
    expandedGitHubPRs.length > 0

  return (
    <div
      className="h-full bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden"
      style={width ? { width: `${width}px` } : undefined}
    >
      <div className="px-4 py-4 border-b border-sidebar-border flex items-center justify-between">
        <div className="text-sm flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="New Project"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {width !== undefined && width < 250 ? (
          <div className="flex items-center gap-1">
            {(hasAnyUnseenPRs || hasNotifications) && (
              <Popover open={bellOpen} onOpenChange={setBellOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 relative"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {(hasAnyUnseenPRs || hasUnreadNotifications) && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <NotificationList />
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
                      Projects
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
                {hasAnythingExpanded && (
                  <button
                    onClick={collapseAll}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                  >
                    <ChevronsDownUp className="w-4 h-4" />
                    Collapse all
                  </button>
                )}
                <button
                  onClick={() =>
                    window.dispatchEvent(new Event('open-palette'))
                  }
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
                {hasAnySessions && pip.isSupported && (
                  <button
                    onClick={handlePipToggle}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
                  >
                    <PictureInPicture2 className="w-4 h-4" />
                    {pip.isOpen ? 'Close PiP' : 'Open PiP'}
                  </button>
                )}
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
                  Projects
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
            {hasAnythingExpanded && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={collapseAll}
                title="Collapse all"
              >
                <ChevronsDownUp className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => window.dispatchEvent(new Event('open-palette'))}
              title="Search"
            >
              <Search className="w-4 h-4" />
            </Button>
            {hasAnySessions && pip.isSupported && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', pip.isOpen && 'text-[#D97757]')}
                onClick={handlePipToggle}
                title={pip.isOpen ? 'Close PiP' : 'Open PiP'}
              >
                <PictureInPicture2 className="w-4 h-4" />
              </Button>
            )}
            {(hasAnyUnseenPRs || hasNotifications) && (
              <Popover open={bellOpen} onOpenChange={setBellOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 relative"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {(hasAnyUnseenPRs || hasUnreadNotifications) && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <NotificationList />
                </PopoverContent>
              </Popover>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              onClick={() => setShowSettingsModal(true)}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
              {hasWebhookWarning && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" />
              )}
            </Button>
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
                  Projects
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
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  ))}
              </>
            )}

            {/* GitHub PR status */}
            {githubPRs.length > 0 && terminals.length > 0 && (
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
                {!githubSectionCollapsed && (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[
                      restrictToVerticalAxis,
                      restrictToParentElement,
                    ]}
                    onDragEnd={handleRepoDragEnd}
                  >
                    <SortableContext
                      items={sortedRepos}
                      strategy={verticalListSortingStrategy}
                    >
                      {sortedRepos.map((repo) => {
                        const repoPRs = githubPRsByRepo.get(repo) ?? []
                        const repoName = repo.split('/')[1] || repo
                        const isCollapsed = collapsedGitHubReposSet.has(repo)
                        const hiddenPRsForRepo = (
                          settings?.hidden_prs ?? []
                        ).filter((h) => h.repo === repo)
                        const hiddenAuthorsForRepo = (
                          settings?.hide_gh_authors ?? []
                        ).filter((h) => h.repo === repo)
                        const hasHiddenItems =
                          hiddenPRsForRepo.length > 0 ||
                          hiddenAuthorsForRepo.length > 0
                        return (
                          <SortableRepoGroup key={repo} repo={repo}>
                            <div className="group/repo-header flex items-center">
                              <button
                                type="button"
                                onClick={() => toggleGitHubRepo(repo)}
                                className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground/70 px-2 py-0.5 hover:text-muted-foreground transition-colors flex-1"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                                )}
                                <Github className="w-3 h-3" />
                                <span className="truncate">{repoName}</span>
                              </button>
                              {hasHiddenItems && (
                                <button
                                  type="button"
                                  onClick={() => setHiddenPRsModalRepo(repo)}
                                  className="mr-2 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer opacity-0 group-hover/repo-header:opacity-100"
                                  title="Manage hidden items"
                                >
                                  <EyeOff className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {!isCollapsed && (
                              <>
                                {repoPRs.map((pr) => (
                                  <PRStatusGroup
                                    key={`${pr.repo}:${pr.prNumber}`}
                                    pr={pr}
                                    expanded={expandedGitHubPRsSet.has(
                                      pr.branch,
                                    )}
                                    onToggle={() => toggleGitHubPR(pr)}
                                    hasNewActivity={hasNewActivity(pr)}
                                    onSeen={() => markPRSeen(pr)}
                                    isActive={
                                      activePR?.prNumber === pr.prNumber &&
                                      activePR?.repo === pr.repo
                                    }
                                  />
                                ))}
                                {(mergedPRsByRepo.get(repo) ?? []).map((pr) => (
                                  <a
                                    key={pr.prNumber}
                                    href={pr.prUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="group/mpr flex items-center cursor-pointer gap-2 pr-3 pl-2 py-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
                                  >
                                    <GitMerge className="w-4 h-4 flex-shrink-0 text-purple-500" />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-xs truncate block">
                                        {pr.prTitle}
                                      </span>
                                      <div className="flex gap-1 items-center">
                                        <GitBranch className="w-2.5 h-2.5" />
                                        <span className="text-[11px] text-muted-foreground/50 truncate">
                                          {pr.branch}
                                        </span>
                                      </div>
                                    </div>
                                  </a>
                                ))}
                                <OlderMergedPRsList repo={repo} />
                              </>
                            )}
                          </SortableRepoGroup>
                        )
                      })}
                    </SortableContext>
                  </DndContext>
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
                setOtherSessionsSectionCollapsed(!otherSessionsSectionCollapsed)
              }
              className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 py-0 hover:text-muted-foreground transition-colors w-full"
            >
              {otherSessionsSectionCollapsed ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              Claude not in project
            </button>
            {!otherSessionsSectionCollapsed &&
              Array.from(orphanSessionGroups.entries()).map(
                ([projectPath, groupSessions]) => (
                  <SessionGroup
                    key={projectPath}
                    projectPath={projectPath}
                    sessions={groupSessions}
                    expanded={expandedSessionGroupsSet.has(projectPath)}
                    defaultCollapsed
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
        onCreated={(id) => {
          selectTerminal(id)
          clearSession()
        }}
      />

      <SettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
      />

      <Dialog
        open={hiddenPRsModalRepo !== null}
        onOpenChange={(open) => !open && setHiddenPRsModalRepo(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Hidden Items</DialogTitle>
            <DialogDescription>
              Manage hidden PRs and comment authors for{' '}
              {hiddenPRsModalRepo?.split('/')[1] || hiddenPRsModalRepo}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-80 overflow-y-auto">
            {(settings?.hide_gh_authors ?? []).filter(
              (h) => h.repo === hiddenPRsModalRepo,
            ).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    Hidden Comment Authors
                  </p>
                  {(settings?.hide_gh_authors ?? [])
                    .filter((h) => h.repo === hiddenPRsModalRepo)
                    .map((entry) => (
                      <div
                        key={entry.author}
                        className="flex items-center justify-between py-1.5 px-2 rounded bg-sidebar-accent/30"
                      >
                        <span className="text-sm">{entry.author}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            setRemovingAuthor(entry.author)
                            try {
                              const current = settings?.hide_gh_authors ?? []
                              const updated = current.filter(
                                (e) =>
                                  !(
                                    e.repo === hiddenPRsModalRepo &&
                                    e.author === entry.author
                                  ),
                              )
                              await updateSettings({ hide_gh_authors: updated })
                            } finally {
                              setRemovingAuthor(null)
                            }
                          }}
                          disabled={removingAuthor === entry.author}
                          className="text-muted-foreground/50 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50 ml-2"
                        >
                          {removingAuthor === entry.author ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            {(settings?.hidden_prs ?? []).filter(
              (h) => h.repo === hiddenPRsModalRepo,
            ).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    Hidden Pull Requests
                  </p>
                  {(settings?.hidden_prs ?? [])
                    .filter((h) => h.repo === hiddenPRsModalRepo)
                    .map((entry) => (
                      <div
                        key={entry.prNumber}
                        className="flex items-center justify-between py-1.5 px-2 rounded bg-sidebar-accent/30"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-sm truncate block">
                            {entry.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            #{entry.prNumber}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            setRemovingPR(entry.prNumber)
                            try {
                              const current = settings?.hidden_prs ?? []
                              const updated = current.filter(
                                (e) =>
                                  !(
                                    e.repo === hiddenPRsModalRepo &&
                                    e.prNumber === entry.prNumber
                                  ),
                              )
                              await updateSettings({ hidden_prs: updated })
                            } finally {
                              setRemovingPR(null)
                            }
                          }}
                          disabled={removingPR === entry.prNumber}
                          className="text-muted-foreground/50 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50 ml-2"
                        >
                          {removingPR === entry.prNumber ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    ))}
                </div>
              )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setHiddenPRsModalRepo(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LogsModal
        open={logsModal.open}
        onOpenChange={(open) =>
          setLogsModal({ open, initialFilter: undefined })
        }
        initialFilter={logsModal.initialFilter}
      />
    </div>
  )
}
