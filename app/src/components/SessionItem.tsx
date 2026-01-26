import { Bot } from 'lucide-react'
import type { SessionWithProject } from '../types'

interface SessionItemProps {
  session: SessionWithProject
}

export function SessionItem({ session }: SessionItemProps) {
  const displayName = session.name || 'Untitled session'
  const statusColor = {
    started: 'bg-blue-500',
    active: 'bg-green-500',
    done: 'bg-gray-500',
    ended: 'bg-gray-500',
    permission_needed: 'bg-yellow-500',
    idle: 'bg-gray-400',
  }[session.status]

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-default">
      <Bot className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="text-xs truncate flex-1">{displayName}</span>
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`}
        title={session.status}
      />
    </div>
  )
}
