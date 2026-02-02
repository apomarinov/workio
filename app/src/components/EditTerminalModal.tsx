import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Terminal } from '@/types'

interface EditTerminalModalProps {
  open: boolean
  terminal: Terminal
  onSave: (updates: { name: string; cwd?: string }) => void
  onCancel: () => void
}

export function EditTerminalModal({
  open,
  terminal,
  onSave,
  onCancel,
}: EditTerminalModalProps) {
  const [name, setName] = useState(terminal.name ?? '')
  const [cwd, setCwd] = useState(terminal.cwd ?? '')

  useEffect(() => {
    if (open) {
      setName(terminal.name ?? '')
      setCwd(terminal.cwd ?? '')
    }
  }, [open, terminal.name, terminal.cwd])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const updates: { name: string; cwd?: string } = { name: name.trim() }
    if (cwd.trim() !== terminal.cwd) {
      updates.cwd = cwd.trim()
    }
    onSave(updates)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="bg-sidebar">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="edit-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoFocus
            />
          </div>
          {!terminal.git_repo && (
            <div className="space-y-2">
              <label htmlFor="edit-cwd" className="text-sm font-medium">
                Path
              </label>
              <div className="relative">
                <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="edit-cwd"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="~"
                  className="pl-10"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
