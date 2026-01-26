import {
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
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { Terminal } from '../types'
import { CreateTerminalModal } from './CreateTerminalModal'
import { FolderGroup } from './FolderGroup'
import { SettingsModal } from './SettingsModal'
import { TerminalItem } from './TerminalItem'

type GroupingMode = 'all' | 'folder'

export function Sidebar() {
  const { terminals, selectTerminal } = useTerminalContext()
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

  const expandAll = () => {
    setExpandedFoldersArray(allFolders)
  }

  const collapseAll = () => {
    setExpandedFoldersArray([])
  }

  const allExpanded = allFolders.every((f) => expandedFolders.has(f))

  return (
    <div className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="px-2 py-1 border-b border-sidebar-border flex items-center justify-between">
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
            <PopoverContent className="w-40 p-1" align="start">
              <button
                onClick={() => {
                  setGroupingMode('folder')
                  setGroupingOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${
                  groupingMode === 'folder' ? 'bg-accent' : ''
                }`}
              >
                <Folder className="w-4 h-4" />
                By Folder
              </button>
              <button
                onClick={() => {
                  setGroupingMode('all')
                  setGroupingOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${
                  groupingMode === 'all' ? 'bg-accent' : ''
                }`}
              >
                <TerminalIcon className="w-4 h-4" />
                All
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
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowCreateModal(true)}
            title="New Terminal"
          >
            <Plus className="w-4 h-4" />
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {groupingMode === 'folder'
          ? Array.from(groupedTerminals.entries()).map(
              ([folderCwd, folderTerminals]) => (
                <FolderGroup
                  key={folderCwd}
                  cwd={folderCwd}
                  terminals={folderTerminals}
                  expanded={expandedFolders.has(folderCwd)}
                  onToggle={() => toggleFolder(folderCwd)}
                />
              ),
            )
          : terminals.map((terminal) => (
              <TerminalItem key={terminal.id} terminal={terminal} />
            ))}
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
