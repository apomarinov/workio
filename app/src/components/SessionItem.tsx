import { useState } from 'react'
import { Trash2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmModal } from './ConfirmModal'
import type { TerminalSession } from '../types'

interface SessionItemProps {
  session: TerminalSession
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}

export function SessionItem({ session, isActive, onSelect, onDelete }: SessionItemProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const displayName = session.name || session.path?.split('/').pop() || 'Untitled'

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    onDelete()
  }

  return (
    <>
      <div
        onClick={onSelect}
        className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
        }`}
      >
        <Terminal className="w-4 h-4 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {session.path && session.name && (
            <p className="text-xs text-muted-foreground truncate">{session.path}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDeleteClick}
          className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Session"
        message={`Are you sure you want to delete "${displayName}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  )
}
