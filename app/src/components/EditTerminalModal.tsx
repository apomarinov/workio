import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface EditTerminalModalProps {
  open: boolean
  currentName: string
  onSave: (name: string) => void
  onCancel: () => void
}

export function EditTerminalModal({
  open,
  currentName,
  onSave,
  onCancel,
}: EditTerminalModalProps) {
  const [name, setName] = useState(currentName)

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(name.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Terminal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Terminal name"
            autoFocus
          />
          <DialogFooter className="mt-4">
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
