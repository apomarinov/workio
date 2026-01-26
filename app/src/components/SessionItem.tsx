import { Bot, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import type { SessionWithProject } from '../types'
import { ConfirmModal } from './ConfirmModal'

interface SessionItemProps {
  session: SessionWithProject
}

export function SessionItem({ session }: SessionItemProps) {
  const { deleteSession } = useClaudeSessions()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const displayName = session.name || 'Untitled'
  const statusColor = {
    started: 'bg-blue-500',
    active: 'bg-green-500',
    done: 'bg-gray-500',
    ended: 'bg-gray-500',
    permission_needed: 'bg-yellow-500',
    idle: 'bg-gray-400',
  }[session.status]

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    deleteSession(session.session_id)
  }

  return (
    <>
      <div className="group flex items-center gap-2 px-2 py-1.5 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-default">
        <Bot className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-xs truncate flex-1">{displayName}</span>
        <div className="hidden group-hover:flex">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDeleteClick}
            className="h-4 w-4 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor} group-hover:hidden`}
          title={session.status}
        />
      </div>

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Session"
        message={`Are you sure you want to delete "${displayName}"? This will remove all messages and data associated with this session.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  )
}
