import type {
  ShellTemplate,
  ShellTemplateEntry,
} from '@domains/settings/schema'
import type { LayoutNode } from '@domains/workspace/schema/terminals'
import { Columns2, Plus, Rows2, Trash2, X } from 'lucide-react'
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
import {
  getLayoutDimensions,
  getLayoutShellIds,
  mapLeafIds,
  removeLeaf,
  splitLeaf,
  updateSizesAtPath,
} from '@/lib/layout'
import { cn } from '@/lib/utils'
import { PaneLayout } from './PaneLayout'

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
  const [layout, setLayout] = useState<LayoutNode | null>(null)

  useEffect(() => {
    if (open) {
      keyCounter.current = 0
      if (template) {
        setName(template.name)
        const mapped =
          template.entries.length > 0
            ? template.entries.map((e) => ({
                ...e,
                _key: keyCounter.current++,
              }))
            : [{ name: 'main', command: '', _key: keyCounter.current++ }]
        setEntries(mapped)
        setLayout((template.layout as LayoutNode) ?? null)
      } else {
        setName('')
        setEntries([{ name: 'main', command: '', _key: keyCounter.current++ }])
        setLayout(null)
      }
    }
  }, [open, template])

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return

    const saved: ShellTemplate = {
      id: template?.id ?? crypto.randomUUID(),
      name: trimmedName,
      entries: entries.map((e) => ({
        name: e.name.trim() || 'main',
        command: e.command.trim(),
      })),
    }
    if (layout?.type === 'split') {
      saved.layout = layout
    }
    onSave(saved)
  }

  const addEntry = (
    splitFromIndex?: number,
    direction?: 'horizontal' | 'vertical',
  ) => {
    const newIndex = entries.length
    setEntries((prev) => [
      ...prev,
      {
        name: `shell-${newIndex + 1}`,
        command: '',
        _key: keyCounter.current++,
      },
    ])

    if (splitFromIndex != null && direction) {
      setLayout((prev) => {
        if (!prev) {
          // First split — create tree from source + new
          return {
            type: 'split',
            direction,
            children: [
              { node: { type: 'leaf', shellId: splitFromIndex }, size: 50 },
              { node: { type: 'leaf', shellId: newIndex }, size: 50 },
            ],
          }
        }
        return splitLeaf(prev, splitFromIndex, newIndex, direction)
      })
    }
  }

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index))
    if (layout) {
      const newLayout = removeLeaf(layout, index)
      if (!newLayout || newLayout.type === 'leaf') {
        setLayout(null)
      } else {
        // Re-index: shift down all indices above the removed one
        const reindex: Record<number, number> = {}
        for (let i = 0; i < entries.length; i++) {
          if (i < index) reindex[i] = i
          else if (i > index) reindex[i] = i - 1
        }
        setLayout(mapLeafIds(newLayout, reindex))
      }
    }
  }

  const updateEntry = (
    index: number,
    field: keyof ShellTemplateEntry,
    value: string,
  ) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    )
  }

  const handleResize = (path: number[], sizes: [number, number]) => {
    if (layout) {
      setLayout(updateSizesAtPath(layout, path, sizes))
    }
  }

  const canSave = name.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        className={cn(
          'sm:max-w-md transition-all',
          layout?.type === 'split' && 'flex flex-col',
        )}
        style={
          layout?.type === 'split'
            ? (() => {
                const { columns, rows } = getLayoutDimensions(layout)
                return {
                  maxWidth: `min(90vw, ${columns * 300}px)`,
                  height: `min(90dvh, ${rows * 200 + 200}px)`,
                  minWidth: '500px',
                  minHeight: '500px',
                }
              })()
            : undefined
        }
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {template ? 'Edit Template' : 'New Template'}
          </DialogTitle>
        </DialogHeader>
        <div
          className={cn(
            'space-y-4',
            layout?.type === 'split' && 'flex-1 min-h-0 flex flex-col',
          )}
        >
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

          {layout ? (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <label className="text-sm text-muted-foreground block">
                Layout
              </label>
              <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
                <PaneLayout
                  key={getLayoutShellIds(layout).join('-')}
                  node={layout}
                  renderLeaf={(entryIndex) => (
                    <TemplateLeaf
                      entry={entries[entryIndex]}
                      index={entryIndex}
                      isMain={entryIndex === 0}
                      onUpdate={(field, value) =>
                        updateEntry(entryIndex, field, value)
                      }
                      onRemove={() => removeEntry(entryIndex)}
                      onSplit={(direction) => addEntry(entryIndex, direction)}
                    />
                  )}
                  onResize={handleResize}
                />
              </div>
            </div>
          ) : (
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
                        updateEntry(index, 'name', e.target.value)
                      }
                      placeholder="Shell name"
                      className="w-24 flex-shrink-0"
                      disabled={isMain}
                    />
                    <Input
                      value={entry.command}
                      onChange={(e) =>
                        updateEntry(index, 'command', e.target.value)
                      }
                      placeholder="Startup command (optional)"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSave) handleSave()
                      }}
                    />
                    <div className="flex-shrink-0 flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        title="Split vertical"
                        onClick={() => addEntry(index, 'horizontal')}
                      >
                        <Columns2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        title="Split horizontal"
                        onClick={() => addEntry(index, 'vertical')}
                      >
                        <Rows2 className="w-3.5 h-3.5" />
                      </Button>
                      {!isMain && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeEntry(index)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              {!layout && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => addEntry()}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Shell
                </Button>
              )}
            </div>
          )}
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

function TemplateLeaf({
  entry,
  index,
  isMain,
  onUpdate,
  onRemove,
  onSplit,
}: {
  entry: EntryWithKey | undefined
  index: number
  isMain: boolean
  onUpdate: (field: keyof ShellTemplateEntry, value: string) => void
  onRemove: () => void
  onSplit: (direction: 'horizontal' | 'vertical') => void
}) {
  if (!entry) return null
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center gap-2 p-3 bg-zinc-900">
      <div className="flex items-center gap-1 w-full">
        <Input
          value={entry.name}
          onChange={(e) => onUpdate('name', e.target.value)}
          placeholder="Name"
          className="h-7 text-xs flex-1"
          disabled={isMain}
        />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent cursor-pointer"
            title="Split vertical"
            onClick={() => onSplit('horizontal')}
          >
            <Columns2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent cursor-pointer"
            title="Split horizontal"
            onClick={() => onSplit('vertical')}
          >
            <Rows2 className="w-3 h-3" />
          </button>
          {!isMain && (
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive cursor-pointer"
              onClick={onRemove}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <Input
        value={entry.command}
        onChange={(e) => onUpdate('command', e.target.value)}
        placeholder="Command (optional)"
        className="h-7 text-xs w-full"
      />
    </div>
  )
}
