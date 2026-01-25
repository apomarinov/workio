import { useState } from 'react'
import { Plus, FolderOpen } from 'lucide-react'
import { SessionItem } from './SessionItem'
import type { TerminalSession } from '../types'

interface SidebarProps {
  sessions: TerminalSession[]
  activeSessionId: number | null
  onSelectSession: (id: number) => void
  onDeleteSession: (id: number) => void
  onCreateSession: (cwd: string, name?: string) => Promise<void>
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
}: SidebarProps) {
  const [showForm, setShowForm] = useState(false)
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    setError(null)
    try {
      await onCreateSession(cwd.trim(), name.trim() || undefined)
      setCwd('')
      setName('')
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="w-64 h-full bg-zinc-900 border-r border-zinc-800 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Sessions</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onSelect={() => onSelectSession(session.id)}
            onDelete={() => onDeleteSession(session.id)}
          />
        ))}
      </div>

      <div className="p-2 border-t border-zinc-800">
        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="relative">
              <FolderOpen className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={cwd}
                placeholder="Project path"
                className="w-full pl-8 pr-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 opacity-50 cursor-not-allowed"
              />
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full px-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !cwd.trim()}
                className="flex-1 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 text-white rounded transition-colors"
              >
                {creating ? '...' : 'Create'}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        )}
      </div>
    </div>
  )
}
