import {
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  LayoutList,
  Plus,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { Terminal } from '../types'
import { FolderGroup } from './FolderGroup'
import { TerminalItem } from './TerminalItem'

type GroupingMode = 'all' | 'folder'

interface SidebarProps {
  terminals: Terminal[]
  activeTerminalId: number | null
  onSelectTerminal: (id: number) => void
  onDeleteTerminal: (id: number) => void
  onCreateTerminal: (cwd: string, name?: string) => Promise<void>
}

export function Sidebar({
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onDeleteTerminal,
  onCreateTerminal,
}: SidebarProps) {
  const [showForm, setShowForm] = useState(false)
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    try {
      await onCreateTerminal(cwd.trim(), name.trim() || undefined)
      setCwd('')
      setName('')
      setShowForm(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create terminal',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <h2 className="text-sm font-semibold text-sidebar-foreground">
          Terminals
        </h2>
      </div>

      <div className="px-2 py-1 border-b border-sidebar-border flex items-center gap-1">
        <Popover>
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
              onClick={() => setGroupingMode('folder')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent ${
                groupingMode === 'folder' ? 'bg-accent' : ''
              }`}
            >
              <Folder className="w-4 h-4" />
              By Folder
            </button>
            <button
              onClick={() => setGroupingMode('all')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent ${
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

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {groupingMode === 'folder'
          ? Array.from(groupedTerminals.entries()).map(
              ([folderCwd, folderTerminals]) => (
                <FolderGroup
                  key={folderCwd}
                  cwd={folderCwd}
                  terminals={folderTerminals}
                  activeTerminalId={activeTerminalId}
                  expanded={expandedFolders.has(folderCwd)}
                  onToggle={() => toggleFolder(folderCwd)}
                  onSelectTerminal={onSelectTerminal}
                  onDeleteTerminal={onDeleteTerminal}
                />
              ),
            )
          : terminals.map((terminal) => (
              <TerminalItem
                key={terminal.id}
                terminal={terminal}
                isActive={terminal.id === activeTerminalId}
                onSelect={() => onSelectTerminal(terminal.id)}
                onDelete={() => onDeleteTerminal(terminal.id)}
              />
            ))}
      </div>

      <div className="p-2 border-t border-sidebar-border">
        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="relative">
              <FolderOpen className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={cwd}
                placeholder="/project/path"
                className="pl-8 h-8 text-sm"
                onChange={(e) => setCwd(e.target.value)}
              />
            </div>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="h-8 text-sm"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={creating || !cwd.trim()}
                className="flex-1"
              >
                {creating ? '...' : 'Create'}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            onClick={() => {
              setShowForm(true)
            }}
            className="w-full justify-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Terminal
          </Button>
        )}
      </div>
    </div>
  )
}
