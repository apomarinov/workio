import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ShellTemplate, ShellTemplateEntry } from '../types'

interface ShellTemplateModalProps {
  open: boolean
  template?: ShellTemplate
  onSave: (template: ShellTemplate) => void
  onCancel: () => void
}

interface EntryWithKey extends ShellTemplateEntry {
  _key: number
}

export function ShellTemplateModal({
  open,
  template,
  onSave,
  onCancel,
}: ShellTemplateModalProps) {
  const [name, setName] = useState('')
  const keyCounter = useRef(0)
  const [entries, setEntries] = useState<EntryWithKey[]>([
    { name: 'main', command: '', _key: 0 },
  ])

  useEffect(() => {
    if (open) {
      keyCounter.current = 0
      if (template) {
        setName(template.name)
        setEntries(
          template.entries.length > 0
            ? template.entries.map((e) => ({
                ...e,
                _key: keyCounter.current++,
              }))
            : [{ name: 'main', command: '', _key: keyCounter.current++ }],
        )
      } else {
        setName('')
        setEntries([{ name: 'main', command: '', _key: keyCounter.current++ }])
      }
    }
  }, [open, template])

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return

    onSave({
      id: template?.id ?? crypto.randomUUID(),
      name: trimmedName,
      entries: entries.map((e) => ({
        name: e.name.trim() || 'main',
        command: e.command.trim(),
      })),
    })
  }

  const addEntry = () => {
    setEntries((prev) => [
      ...prev,
      {
        name: `shell-${prev.length + 1}`,
        command: '',
        _key: keyCounter.current++,
      },
    ])
  }

  const removeEntry = (key: number) => {
    setEntries((prev) => prev.filter((e) => e._key !== key))
  }

  const updateEntry = (
    key: number,
    field: keyof ShellTemplateEntry,
    value: string,
  ) => {
    setEntries((prev) =>
      prev.map((e) => (e._key === key ? { ...e, [field]: value } : e)),
    )
  }

  const canSave = name.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {template ? 'Edit Template' : 'New Template'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">
              Template Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dev Server"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) handleSave()
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground block">
              Shells
            </label>
            {entries.map((entry, index) => {
              const isMain = index === 0
              return (
                <div key={entry._key} className="flex items-center gap-2">
                  <Input
                    value={entry.name}
                    onChange={(e) =>
                      updateEntry(entry._key, 'name', e.target.value)
                    }
                    placeholder="Shell name"
                    className="w-24 flex-shrink-0"
                    disabled={isMain}
                  />
                  <Input
                    value={entry.command}
                    onChange={(e) =>
                      updateEntry(entry._key, 'command', e.target.value)
                    }
                    placeholder="Startup command (optional)"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSave) handleSave()
                    }}
                  />
                  {!isMain && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeEntry(entry._key)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {isMain && <div className="w-8 flex-shrink-0" />}
                </div>
              )
            })}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={addEntry}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Shell
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
