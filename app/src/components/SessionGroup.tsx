import { ChevronDown, ChevronRight, Folder, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import type { SessionWithProject } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { SessionItem } from './SessionItem'
import { TruncatedPath } from './TruncatedPath'

interface SessionGroupProps {
  projectPath: string
  sessions: SessionWithProject[]
  expanded: boolean
  onToggle: () => void
}

export function SessionGroup({
  projectPath,
  sessions,
  expanded,
  onToggle,
}: SessionGroupProps) {
  const { deleteSessions } = useClaudeSessions()
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = () => {
    setShowDeleteModal(false)
    deleteSessions(sessions.map((s) => s.session_id))
  }

  return (
    <>
      <div>
        <div
          onClick={onToggle}
          className="group flex items-start gap-2 pr-3 pl-2 py-2 rounded-lg cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors min-w-0"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 flex-shrink-0" />
              <TruncatedPath
                path={projectPath}
                className="text-sm font-medium"
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0 group-hover:hidden">
            {sessions.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDeleteClick}
            className="hidden group-hover:flex h-5 w-5 flex-shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        {expanded && (
          <div className="ml-4 mt-1 space-y-0.5">
            {sessions.map((session) => (
              <SessionItem key={session.session_id} session={session} />
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Sessions"
        message={`Are you sure you want to delete all ${sessions.length} sessions in this group? This will remove all messages and data associated with these sessions.`}
        confirmLabel="Delete All"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  )
}
