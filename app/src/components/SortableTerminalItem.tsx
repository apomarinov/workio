import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SessionWithProject, Terminal } from '../types'
import { TerminalItem } from './TerminalItem'

interface SortableTerminalItemProps {
  terminal: Terminal
  sessions: SessionWithProject[]
  sessionsExpanded: boolean
  onToggleSessions: () => void
}

export function SortableTerminalItem({
  terminal,
  sessions,
  sessionsExpanded,
  onToggleSessions,
}: SortableTerminalItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: terminal.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TerminalItem
        terminal={terminal}
        sessions={sessions}
        sessionsExpanded={sessionsExpanded}
        onToggleSessions={onToggleSessions}
      />
    </div>
  )
}
