import { AlertTriangle, Bot, ChevronRight, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import type { SessionWithProject } from '../types'
import { ConfirmModal } from './ConfirmModal'

interface SessionItemProps {
  session: SessionWithProject
}

export function SessionItem({ session }: SessionItemProps) {
  const { deleteSession } = useClaudeSessions()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const displayName = session.name || 'Untitled'

  useEffect(() => {
    const handleFlash = (e: CustomEvent<{ sessionId: string }>) => {
      if (e.detail.sessionId === session.session_id) {
        setIsFlashing(true)
        setTimeout(() => setIsFlashing(false), 2100)
      }
    }
    window.addEventListener('flash-session', handleFlash as EventListener)
    return () =>
      window.removeEventListener('flash-session', handleFlash as EventListener)
  }, [session.session_id])

  const statusColor = {
    started: 'text-green-500',
    active: 'text-[#D97757]',
    done: 'text-gray-500',
    ended: 'text-gray-500',
    permission_needed: 'text-[#D97757]',
    idle: 'text-gray-400',
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
      <div
        className={cn(
          'group flex items-start gap-2 px-2 py-1.5 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-default',
          isFlashing && 'animate-flash',
        )}
      >
        <div className="flex items-center gap-1 mt-0.5">
          {session.status === 'permission_needed' && (
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-yellow-500 animate-pulse mr-1" />
          )}
          {['active', 'permission_needed'].includes(session.status) && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" className="w-3.5 h-3.5">
              <path
                fill="none"
                stroke="#D97757"
                strokeWidth="40"
                strokeLinecap="round"
                strokeDasharray="300 385"
                strokeDashoffset="0"
                d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  calcMode="spline"
                  dur="2s"
                  values="685;-685"
                  keySplines="0 0 1 1"
                  repeatCount="indefinite"
                />
              </path>
            </svg>
          )}
          {!['active', 'permission_needed'].includes(session.status) && (
            <Bot
              className={cn('w-3.5 h-3.5 flex-shrink-0', statusColor)}
              aria-label={session.status}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs truncate block">{displayName}</span>
          {session.latest_user_message && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 flex gap-1 items-center">
              <ChevronRight className='w-3' /> {session.latest_user_message}
            </p>
          )}
          {session.latest_agent_message && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {session.latest_agent_message}
            </p>
          )}
        </div>
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
