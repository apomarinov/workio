import { Loader2 } from 'lucide-react'
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
import { toast } from '@/components/ui/sonner'
import type { Terminal } from '@/types'

interface EditTerminalModalProps {
  open: boolean
  terminal: Terminal
  onSave: (updates: {
    name: string
    settings?: { defaultClaudeCommand?: string } | null
  }) => Promise<void> | void
  onCancel: () => void
}

export function EditTerminalModal({
  open,
  terminal,
  onSave,
  onCancel,
}: EditTerminalModalProps) {
  const [name, setName] = useState(terminal.name ?? '')
  const [defaultClaudeCommand, setDefaultClaudeCommand] = useState(
    terminal.settings?.defaultClaudeCommand ?? '',
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(terminal.name ?? '')
      setDefaultClaudeCommand(terminal.settings?.defaultClaudeCommand ?? '')
    }
  }, [open, terminal.name, terminal.settings?.defaultClaudeCommand])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedCmd = defaultClaudeCommand.trim()
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        settings: trimmedCmd ? { defaultClaudeCommand: trimmedCmd } : null,
      })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update project',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && !saving && onCancel()}
    >
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
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-claude-cmd" className="text-sm font-medium">
              Default Claude Command
            </label>
            <Input
              id="edit-claude-cmd"
              value={defaultClaudeCommand}
              onChange={(e) => setDefaultClaudeCommand(e.target.value)}
              placeholder="claude"
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
