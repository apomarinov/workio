import {
  Bot,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  LayoutList,
  Plus,
  Settings,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTerminalContext } from '../context/TerminalContext'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { SessionWithProject, Terminal } from '../types'
import { CreateTerminalModal } from './CreateTerminalModal'
import { FolderGroup } from './FolderGroup'
import { SessionGroup } from './SessionGroup'
import { SessionItem } from './SessionItem'
import { SettingsModal } from './SettingsModal'
import { TerminalItem } from './TerminalItem'
import { cn } from '@/lib/utils'

type GroupingMode = 'all' | 'folder' | 'sessions'

interface SidebarProps {
  width?: number
}

export function Sidebar({ width }: SidebarProps) {
  const { terminals, selectTerminal } = useTerminalContext()
  const { sessions } = useClaudeSessions()
  const [showCreateModal, setShowCreateModal] = useState(false)
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
  const [expandedOtherSessions, setExpandedOtherSessions] =
    useLocalStorage<number[]>('sidebar-expanded-other-sessions', [])

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
  // - otherSessionsForTerminal: sessions with project_path matching terminal cwd but no valid terminal_id
  // - orphanSessionGroups: sessions with no matching terminal, grouped by project_path
  const { sessionsForTerminal, otherSessionsForTerminal, orphanSessionGroups } =
    useMemo(() => {
      const terminalIds = new Set(terminals.map((t) => t.id))
      const terminalCwds = new Set(terminals.map((t) => t.cwd))
      const sessionsForTerminal = new Map<number, SessionWithProject[]>()
      const otherSessionsForTerminal = new Map<string, SessionWithProject[]>()
      const orphanGroups = new Map<string, SessionWithProject[]>()

      for (const session of sessions) {
        if (session.terminal_id && terminalIds.has(session.terminal_id)) {
          // Session has a terminal_id that matches an existing terminal
          const existing = sessionsForTerminal.get(session.terminal_id) || []
          existing.push(session)
          sessionsForTerminal.set(session.terminal_id, existing)
        } else if (terminalCwds.has(session.project_path)) {
          // Session has no valid terminal_id but project_path matches a terminal cwd
          const existing =
            otherSessionsForTerminal.get(session.project_path) || []
          existing.push(session)
          otherSessionsForTerminal.set(session.project_path, existing)
        } else {
          // Orphan session - group by project_path
          const existing = orphanGroups.get(session.project_path) || []
          existing.push(session)
          orphanGroups.set(session.project_path, existing)
        }
      }

      return {
        sessionsForTerminal,
        otherSessionsForTerminal,
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

  const expandedOtherSessionsSet = useMemo(
    () => new Set(expandedOtherSessions),
    [expandedOtherSessions],
  )

  const toggleTerminalSessions = (terminalId: number) => {
    setExpandedTerminalSessions((prev) => {
      if (prev.includes(terminalId)) {
        return prev.filter((id) => id !== terminalId)
      }
      return [...prev, terminalId]
    })
  }

  const toggleOtherSessions = (terminalId: number) => {
    setExpandedOtherSessions((prev) => {
      if (prev.includes(terminalId)) {
        return prev.filter((id) => id !== terminalId)
      }
      return [...prev, terminalId]
    })
  }

  const expandAll = () => {
    setExpandedFoldersArray(allFolders)
  }

  const collapseAll = () => {
    setExpandedFoldersArray([])
  }

  const allExpanded = allFolders.every((f) => expandedFolders.has(f))

  return (
    <div
      className="h-full bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden"
      style={width ? { width: `${width}px` } : undefined}
    >
      <div className="px-4 py-4 border-b border-sidebar-border flex items-center justify-between">
        <div className="text-sm flex items-center gap-2">
          Terminals{' '}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowCreateModal(true)}
            title="New Terminal"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
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
                Sessions
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
          {groupingMode === 'folder' && (
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
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowSettingsModal(true)}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 @container/sidebar">
        {groupingMode === 'sessions'
          ? sessions.map((session) => (
            <SessionItem
              key={session.session_id}
              session={session}
              showGitBranch
            />
          ))
          : groupingMode === 'folder'
            ? Array.from(groupedTerminals.entries()).map(
              ([folderCwd, folderTerminals]) => (
                <FolderGroup
                  key={folderCwd}
                  cwd={folderCwd}
                  terminals={folderTerminals}
                  expanded={expandedFolders.has(folderCwd)}
                  onToggle={() => toggleFolder(folderCwd)}
                  sessionsForTerminal={sessionsForTerminal}
                  otherSessionsForCwd={
                    otherSessionsForTerminal.get(folderCwd) || []
                  }
                  expandedTerminalSessions={expandedTerminalSessionsSet}
                  onToggleTerminalSessions={toggleTerminalSessions}
                  expandedOtherSessions={expandedOtherSessionsSet}
                  onToggleOtherSessions={toggleOtherSessions}
                />
              ),
            )
            : terminals.map((terminal) => (
              <TerminalItem
                key={terminal.id}
                terminal={terminal}
                sessions={sessionsForTerminal.get(terminal.id) || []}
                otherSessions={
                  otherSessionsForTerminal.get(terminal.cwd) || []
                }
                sessionsExpanded={expandedTerminalSessionsSet.has(
                  terminal.id,
                )}
                onToggleSessions={() => toggleTerminalSessions(terminal.id)}
                otherSessionsExpanded={expandedOtherSessionsSet.has(
                  terminal.id,
                )}
                onToggleOtherSessions={() => toggleOtherSessions(terminal.id)}
              />
            ))}

        {/* Orphan sessions - grouped by project path (not shown in sessions mode) */}
        {groupingMode !== 'sessions' && orphanSessionGroups.size > 0 && (
          <>
            <div className={cn("border-t border-sidebar-border my-2", terminals.length === 0 && 'border-none')} />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2 pb-1">
              Claude Sessions
            </p>
            {Array.from(orphanSessionGroups.entries()).map(
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

      <SettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
      />
    </div>
  )
}
