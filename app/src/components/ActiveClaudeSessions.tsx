import { useState, useEffect } from 'react'
import { MessageSquare, GitBranch, Folder } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { getClaudeSessions } from '../lib/api'
import { twMerge } from "tailwind-merge"
import type { ClaudeSession } from '../types'

interface ActiveClaudeSessionsProps {
  onSelectPath?: (path: string) => void
}

export function ActiveClaudeSessions({ onSelectPath }: ActiveClaudeSessionsProps) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  useEffect(() => {
    getClaudeSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="text-muted-foreground text-sm">Loading active sessions...</div>
    )
  }

  if (sessions.length === 0) {
    return null
  }

  return (
    <div className="w-full max-w-md mb-8">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Active Claude Sessions</h2>
      <div className="space-y-2">
        {sessions.map((session) => (
          <Card
            key={session.session_id}
            onClick={() => {
              setSelectedSessionId(session.session_id)
              onSelectPath?.(session.path || '')
            }}
            className={twMerge("p-3 cursor-pointer hover:bg-accent/50 transition-colors", session.session_id === selectedSessionId && 'border border-blue-500')}
          >
            <div className="flex items-start gap-3">
              <MessageSquare className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {session.name || 'Unnamed session'}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 truncate">
                    <Folder className="w-3 h-3" />
                    {session.path}
                  </span>
                  {session.git_branch && (
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <GitBranch className="w-3 h-3" />
                      {session.git_branch}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
