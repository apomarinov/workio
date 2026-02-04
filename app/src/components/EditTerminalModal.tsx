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
  onSave: (updates: { name: string }) => void
  onCancel: () => void
}

export function EditTerminalModal({
  open,
  terminal,
  onSave,
  onCancel,
}: EditTerminalModalProps) {
  const [name, setName] = useState(terminal.name ?? '')

  useEffect(() => {
    if (open) {
      setName(terminal.name ?? '')
    }
  }, [open, terminal.name])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ name: name.trim() })
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
            />
          </div>
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
