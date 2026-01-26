import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import type { Terminal } from '../types'
import { TerminalItem } from './TerminalItem'

interface FolderGroupProps {
  cwd: string
  terminals: Terminal[]
  activeTerminalId: number | null
  expanded: boolean
  onToggle: () => void
  onSelectTerminal: (id: number) => void
  onDeleteTerminal: (id: number) => void
}

export function FolderGroup({
  cwd,
  terminals,
  activeTerminalId,
  expanded,
  onToggle,
  onSelectTerminal,
  onDeleteTerminal,
}: FolderGroupProps) {
  const folderName = cwd.split('/').pop() || cwd

  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
        )}
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm font-medium truncate flex-1">
          {folderName}
        </span>
        <span className="text-xs text-muted-foreground">
          {terminals.length}
        </span>
      </div>
      {expanded && (
        <div className="ml-4 space-y-1">
          {terminals.map((terminal) => (
            <TerminalItem
              key={terminal.id}
              terminal={terminal}
              isActive={terminal.id === activeTerminalId}
              onSelect={() => onSelectTerminal(terminal.id)}
              onDelete={() => onDeleteTerminal(terminal.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
