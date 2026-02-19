import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo } from 'react'
import type { SessionWithProject, Terminal } from '../types'
import { TerminalItem } from './TerminalItem'

interface SortableTerminalItemProps {
  terminal: Terminal
  sessions: SessionWithProject[]
  sessionsExpanded: boolean
  onToggleTerminalSessions: (terminalId: number) => void
  shortcutIndex?: number
}

export const SortableTerminalItem = memo(function SortableTerminalItem({
  terminal,
  sessions,
  sessionsExpanded,
  onToggleTerminalSessions,
  shortcutIndex,
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
        onToggleTerminalSessions={onToggleTerminalSessions}
        shortcutIndex={shortcutIndex}
      />
    </div>
  )
})
