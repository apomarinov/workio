import { useState, useEffect } from 'react'
import { MessageSquare, GitBranch, Folder } from 'lucide-react'
import { getClaudeSessions } from '../lib/api'
import type { ClaudeSession } from '../types'

interface ActiveClaudeSessionsProps {
  onSelectPath?: (path: string) => void
}

export function ActiveClaudeSessions({ onSelectPath }: ActiveClaudeSessionsProps) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getClaudeSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="text-zinc-500 text-sm">Loading active sessions...</div>
    )
  }

  if (sessions.length === 0) {
    return null
  }

  return (
    <div className="w-full max-w-md mb-8">
      <h2 className="text-sm font-medium text-zinc-400 mb-3">Active Claude Sessions</h2>
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.session_id}
            onClick={() => onSelectPath?.(session.path || '')}
            className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 cursor-pointer transition-colors"
          >
            <div className="flex items-start gap-3">
              <MessageSquare className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {session.name || 'Unnamed session'}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
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
          </div>
        ))}
      </div>
    </div>
  )
}
