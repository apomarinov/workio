import {
  AlertTriangle,
  Pencil,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTerminalContext } from '../context/TerminalContext'
import { useTerminals } from '../hooks/useTerminals'
import type { Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { EditTerminalModal } from './EditTerminalModal'
import { TruncatedPath } from './TruncatedPath'

interface TerminalItemProps {
  terminal: Terminal
  hideFolder?: boolean
}

export function TerminalItem({ terminal, hideFolder }: TerminalItemProps) {
  const { activeTerminal, selectTerminal } = useTerminalContext()
  const { updateTerminal, deleteTerminal } = useTerminals()
  const isActive = terminal.id === activeTerminal?.id
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const displayName = terminal.name || terminal.cwd || 'Untitled'

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowEditModal(true)
  }

  const handleEditSave = (name: string) => {
    setShowEditModal(false)
    updateTerminal(terminal.id, { name })
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    deleteTerminal(terminal.id)
  }

  return (
    <>
      <div
        onClick={() => selectTerminal(terminal.id)}
        className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
        } ${terminal.orphaned ? 'opacity-60' : ''}`}
      >
        {terminal.orphaned ? (
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-yellow-500" />
        ) : (
          <TerminalIcon className="w-4 h-4 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {terminal.orphaned ? (
            <p className="text-xs truncate text-yellow-500">Path not found</p>
          ) : (
            !hideFolder &&
            terminal.name && (
              <TruncatedPath
                path={terminal.cwd}
                className="text-xs text-muted-foreground"
              />
            )
          )}
        </div>
        <div className="h-7 invisible pointer-events-none"></div>
        <div className="hidden group-hover:flex">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleEditClick}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDeleteClick}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <EditTerminalModal
        open={showEditModal}
        currentName={terminal.name || ''}
        onSave={handleEditSave}
        onCancel={() => setShowEditModal(false)}
      />

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Terminal"
        message={`Are you sure you want to delete "${displayName}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  )
}
