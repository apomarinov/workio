import { FolderOpen, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import type { Terminal } from '../types'
import { TerminalItem } from './TerminalItem'

interface SidebarProps {
  terminals: Terminal[]
  activeTerminalId: number | null
  onSelectTerminal: (id: number) => void
  onDeleteTerminal: (id: number) => void
  onCreateTerminal: (cwd: string, name?: string) => Promise<void>
}

export function Sidebar({
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onDeleteTerminal,
  onCreateTerminal,
}: SidebarProps) {
  const [showForm, setShowForm] = useState(false)
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    try {
      await onCreateTerminal(cwd.trim(), name.trim() || undefined)
      setCwd('')
      setName('')
      setShowForm(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create terminal',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <h2 className="text-sm font-semibold text-sidebar-foreground">
          Terminals
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {terminals.map((terminal) => (
          <TerminalItem
            key={terminal.id}
            terminal={terminal}
            isActive={terminal.id === activeTerminalId}
            onSelect={() => onSelectTerminal(terminal.id)}
            onDelete={() => onDeleteTerminal(terminal.id)}
          />
        ))}
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
            New Terminal
          </Button>
        )}
      </div>
    </div>
  )
}
