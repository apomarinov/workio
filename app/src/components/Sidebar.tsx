import { useState, useEffect, useMemo } from 'react'
import { Plus, FolderOpen, MessageSquare, GitBranch, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { SessionItem } from './SessionItem'
import { getClaudeSessions } from '../lib/api'
import type { TerminalSession, ClaudeSession } from '../types'

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
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([])

  useEffect(() => {
    getClaudeSessions()
      .then(setClaudeSessions)
      .catch(console.error)
  }, [])

  // Filter out Claude sessions that already have a terminal session with the same path
  const terminalPaths = useMemo(() => new Set(sessions.map(s => s.path)), [sessions])
  const filteredClaudeSessions = useMemo(
    () => claudeSessions.filter(cs => cs.path && !terminalPaths.has(cs.path)),
    [claudeSessions, terminalPaths]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    try {
      await onCreateSession(cwd.trim(), name.trim() || undefined)
      setCwd('')
      setName('')
      setShowForm(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <h2 className="text-sm font-semibold text-sidebar-foreground">Sessions</h2>
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

        {filteredClaudeSessions.length > 0 && (
          <>
            <div className="pt-3 pb-1 px-2">
              <span className="text-xs font-medium text-muted-foreground">Other Active Sessions</span>
            </div>
            {filteredClaudeSessions.map((session) => (
              <Popover key={session.session_id}>
                <PopoverTrigger asChild>
                  <div className="flex items-start gap-2 p-2 rounded-md cursor-pointer hover:bg-sidebar-accent transition-colors">
                    <MessageSquare className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-sidebar-foreground">
                        {session.name || 'Unnamed session'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
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
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-48 p-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start text-sm"
                    onClick={() => onCreateSession(session.path || '', session.name || undefined)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Terminal
                  </Button>
                </PopoverContent>
              </Popover>
            ))}
          </>
        )}
      </div>

      <div className="p-2 border-t border-sidebar-border">
        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="relative">
              <FolderOpen className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={cwd}
                placeholder="/project/path"
                className="pl-8 h-8 text-sm"
                onChange={(e) => setCwd(e.target.value)}
              />
            </div>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="h-8 text-sm"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={creating || !cwd.trim()}
                className="flex-1"
              >
                {creating ? '...' : 'Create'}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setShowForm(true)}
            className="w-full justify-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Session
          </Button>
        )}
      </div>
    </div>
  )
}
