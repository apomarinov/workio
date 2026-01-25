import { useState } from 'react'
import { Trash2, Terminal } from 'lucide-react'
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
            ? 'bg-zinc-800 text-white'
            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
        }`}
      >
        <Terminal className="w-4 h-4 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {session.path && session.name && (
            <p className="text-xs text-zinc-500 truncate">{session.path}</p>
          )}
        </div>
        <button
          onClick={handleDeleteClick}
          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-opacity"
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
