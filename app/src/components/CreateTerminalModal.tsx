import { FolderOpen, Plus, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '../hooks/useSettings'
import { useTerminals } from '../hooks/useTerminals'

interface CreateTerminalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (terminalId: number) => void
}

export function CreateTerminalModal({
  open,
  onOpenChange,
  onCreated,
}: CreateTerminalModalProps) {
  const { createTerminal } = useTerminals()
  const { settings } = useSettings()
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [shell, setShell] = useState('')
  const [creating, setCreating] = useState(false)

  const defaultShell = settings?.default_shell ?? '/bin/bash'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    try {
      const terminal = await createTerminal(
        cwd.trim(),
        name.trim() || undefined,
        shell.trim() || undefined,
      )
      setCwd('')
      setName('')
      setShell('')
      onOpenChange(false)
      onCreated?.(terminal.id)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create terminal',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Terminal</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="cwd" className="text-sm font-medium">
              Path <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="cwd"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="pl-10"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="shell" className="text-sm font-medium">
              Shell
            </label>
            <div className="relative">
              <TerminalSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="shell"
                type="text"
                value={shell}
                onChange={(e) => setShell(e.target.value)}
                placeholder={defaultShell}
                className="pl-10"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={creating || !cwd.trim()}
            className="w-full mt-2"
          >
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
