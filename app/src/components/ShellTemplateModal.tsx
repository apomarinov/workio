import type {
  ShellTemplate,
  ShellTemplateEntry,
} from '@domains/settings/schema'
import type { LayoutNode } from '@domains/workspace/schema/terminals'
import { Columns2, Plus, Rows2, X } from 'lucide-react'
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
  mode?: 'edit' | 'run'
  template?: ShellTemplate
  terminalName?: string
  onSave: (template: ShellTemplate) => void
  onCancel: () => void
}

interface EntryWithKey extends ShellTemplateEntry {
  _key: number
}

type Tab = {
  id: number
  type: 'standalone' | 'layout'
  layoutIndex?: number
}

export function ShellTemplateModal({
  open,
  mode = 'edit',
  template,
  terminalName,
  onSave,
  onCancel,
}: ShellTemplateModalProps) {
  const isRun = mode === 'run'
  const [name, setName] = useState('')
  const keyCounter = useRef(0)
  const [entries, setEntries] = useState<EntryWithKey[]>([
    { name: 'main', command: '', _key: 0 },
  ])
  const [layouts, setLayouts] = useState<LayoutNode[]>([])
  const [activeTab, setActiveTab] = useState(0)

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
        setLayouts((template.layouts as LayoutNode[]) ?? [])
      } else {
        setName('')
        setEntries([{ name: 'main', command: '', _key: keyCounter.current++ }])
        setLayouts([])
      }
      setActiveTab(0)
    }
  }, [open, template])

  // Compute tabs from entries + layouts
  const allLayoutIds = new Set(layouts.flatMap(getLayoutShellIds))
  const tabs: Tab[] = []

  for (let i = 0; i < entries.length; i++) {
    if (!allLayoutIds.has(i)) {
      tabs.push({ id: i, type: 'standalone' })
    }
  }
  for (let li = 0; li < layouts.length; li++) {
    const ids = getLayoutShellIds(layouts[li])
    const firstId = Math.min(...ids)
    tabs.push({ id: firstId, type: 'layout', layoutIndex: li })
  }
  tabs.sort((a, b) => a.id - b.id)

  // Resolve active tab — fall back to nearest if current was removed
  let currentTab = tabs.find((t) => t.id === activeTab)
  if (!currentTab && tabs.length > 0) {
    currentTab = tabs.reduce((best, t) =>
      Math.abs(t.id - activeTab) < Math.abs(best.id - activeTab) ? t : best,
    )
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!isRun && !trimmedName) return

    const saved: ShellTemplate = {
      id: template?.id ?? crypto.randomUUID(),
      name: trimmedName || template?.name || '',
      entries: entries.map((e) => ({
        name: e.name.trim() || 'main',
        command: e.command.trim(),
      })),
    }
    const splitLayouts = layouts.filter((n) => n.type === 'split')
    if (splitLayouts.length > 0) {
      saved.layouts = splitLayouts
    }
    onSave(saved)
  }

  const addEntry = (
    splitFromIndex?: number,
    direction?: 'horizontal' | 'vertical',
  ) => {
    const newIndex = entries.length
    const usedNames = new Set(entries.map((e) => e.name))
    let n = 2
    while (usedNames.has(`shell-${n}`)) n++
    setEntries((prev) => [
      ...prev,
      {
        name: `shell-${n}`,
        command: '',
        _key: keyCounter.current++,
      },
    ])

    if (splitFromIndex != null && direction) {
      setLayouts((prev) => {
        const groupIdx = prev.findIndex((node) =>
          getLayoutShellIds(node).includes(splitFromIndex),
        )
        if (groupIdx >= 0) {
          return prev.map((node, i) =>
            i === groupIdx
              ? splitLeaf(node, splitFromIndex, newIndex, direction)
              : node,
          )
        }
        return [
          ...prev,
          {
            type: 'split' as const,
            direction,
            children: [
              {
                node: { type: 'leaf' as const, shellId: splitFromIndex },
                size: 50,
              },
              {
                node: { type: 'leaf' as const, shellId: newIndex },
                size: 50,
              },
            ],
          },
        ]
      })
    } else {
      // Adding standalone shell — switch to it
      setActiveTab(newIndex)
    }
  }

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index))

    setLayouts((prev) => {
      let updated = prev
        .map((node) => {
          if (!getLayoutShellIds(node).includes(index)) return node
          const newNode = removeLeaf(node, index)
          if (!newNode || newNode.type === 'leaf') return null
          return newNode
        })
        .filter((n): n is LayoutNode => n !== null)

      const reindex: Record<number, number> = {}
      for (let i = 0; i < entries.length; i++) {
        if (i < index) reindex[i] = i
        else if (i > index) reindex[i] = i - 1
      }
      updated = updated.map((node) => mapLeafIds(node, reindex))
      return updated
    })

    // Adjust activeTab for re-indexing
    if (activeTab > index) {
      setActiveTab(activeTab - 1)
    } else if (activeTab === index) {
      const tabIdx = tabs.findIndex((t) => t.id === index)
      const prev = tabs[Math.max(0, tabIdx - 1)]
      setActiveTab(prev?.id ?? 0)
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

  const handleLayoutResize = (
    layoutIndex: number,
    path: number[],
    sizes: [number, number],
  ) => {
    setLayouts((prev) =>
      prev.map((node, i) =>
        i === layoutIndex ? updateSizesAtPath(node, path, sizes) : node,
      ),
    )
  }

  // Track duplicate shell names
  const nameCounts = new Map<string, number>()
  for (const e of entries) {
    const n = e.name.trim().toLowerCase()
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1)
  }
  const hasDuplicateNames = [...nameCounts.values()].some((c) => c > 1)

  const canSave = (isRun || name.trim().length > 0) && !hasDuplicateNames

  // Compute content height for current tab
  let contentHeight = 120
  if (currentTab?.type === 'layout' && currentTab.layoutIndex != null) {
    const node = layouts[currentTab.layoutIndex]
    if (node) {
      contentHeight = getLayoutDimensions(node).rows * 120
    }
  }

  // Compute dialog width from widest layout
  const maxCols = layouts.reduce((max, node) => {
    const { columns } = getLayoutDimensions(node)
    return Math.max(max, columns)
  }, 0)
  const dialogStyle =
    maxCols > 1
      ? {
          maxWidth: `min(90vw, ${maxCols * 300}px)`,
          minWidth: '500px',
        }
      : undefined

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        className="sm:max-w-md transition-all max-h-[90vh] flex flex-col"
        style={dialogStyle}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {isRun
              ? `Run "${template?.name}"`
              : template
                ? 'Edit Template'
                : 'New Template'}
          </DialogTitle>
          {isRun && (
            <p className="text-sm text-muted-foreground">
              {terminalName && (
                <>
                  In{' '}
                  <span className="font-medium text-foreground">
                    {terminalName}
                  </span>
                  , {'this will '}
                </>
              )}
              {!terminalName && 'This will '}
              <span className="mx-1 px-1.5 py-0.5 rounded-md border border-red-400/80 text-red-400/80">
                kill all
              </span>{' '}
              shells and create{' '}
              {`${entries.length} new shell${entries.length !== 1 ? 's' : ''}`}:
            </p>
          )}
        </DialogHeader>
        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
          {!isRun && (
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
          )}

          {/* Terminal-like view */}
          <div className="flex flex-col rounded-md border border-border overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center bg-black/30 border-b border-border overflow-x-auto">
              {tabs.map((tab) => {
                const entry = entries[tab.id]
                const isActive = currentTab?.id === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={cn(
                      'group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border cursor-pointer whitespace-nowrap shrink-0',
                      isActive
                        ? 'bg-zinc-900 text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span>{entry?.name || 'shell'}</span>
                    {tab.id !== 0 && (
                      <span
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeEntry(tab.id)
                        }}
                        onKeyDown={() => {}}
                      >
                        <X className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                className="flex items-center justify-center px-2 py-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => addEntry()}
                title="Add Shell"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content area */}
            <div
              className="bg-zinc-900"
              style={{ height: `${contentHeight}px` }}
            >
              {currentTab?.type === 'layout' &&
              currentTab.layoutIndex != null ? (
                <PaneLayout
                  key={getLayoutShellIds(layouts[currentTab.layoutIndex]).join(
                    '-',
                  )}
                  node={layouts[currentTab.layoutIndex]}
                  renderLeaf={(entryIndex) => (
                    <TemplateLeaf
                      entry={entries[entryIndex]}
                      index={entryIndex}
                      isMain={entryIndex === 0}
                      isDuplicate={
                        (nameCounts.get(
                          entries[entryIndex]?.name.trim().toLowerCase() ?? '',
                        ) ?? 0) > 1
                      }
                      onUpdate={(field, value) =>
                        updateEntry(entryIndex, field, value)
                      }
                      onRemove={() => removeEntry(entryIndex)}
                      onSplit={(direction) => addEntry(entryIndex, direction)}
                    />
                  )}
                  onResize={(path, sizes) =>
                    handleLayoutResize(currentTab.layoutIndex!, path, sizes)
                  }
                />
              ) : currentTab ? (
                <TemplateLeaf
                  entry={entries[currentTab.id]}
                  index={currentTab.id}
                  isMain={currentTab.id === 0}
                  isDuplicate={
                    (nameCounts.get(
                      entries[currentTab.id]?.name.trim().toLowerCase() ?? '',
                    ) ?? 0) > 1
                  }
                  onUpdate={(field, value) =>
                    updateEntry(currentTab.id, field, value)
                  }
                  onRemove={() => removeEntry(currentTab.id)}
                  onSplit={(direction) => addEntry(currentTab.id, direction)}
                />
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isRun ? 'Run' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TemplateLeaf({
  entry,
  index: _index,
  isMain,
  isDuplicate,
  onUpdate,
  onRemove,
  onSplit,
}: {
  entry: EntryWithKey | undefined
  index: number
  isMain: boolean
  isDuplicate: boolean
  onUpdate: (field: keyof ShellTemplateEntry, value: string) => void
  onRemove: () => void
  onSplit: (direction: 'horizontal' | 'vertical') => void
}) {
  if (!entry) return null
  return (
    <div className="relative h-full w-full flex flex-col items-center justify-start gap-2 p-3 bg-zinc-900">
      <div className="flex items-center gap-1 w-full">
        <Input
          value={entry.name}
          onChange={(e) => onUpdate('name', e.target.value)}
          placeholder="Name"
          className={cn(
            'h-7 text-xs flex-1',
            isDuplicate && 'border-red-500 focus-visible:ring-red-500',
          )}
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
      <textarea
        value={entry.command}
        onChange={(e) => onUpdate('command', e.target.value)}
        placeholder="Command (optional)"
        className="flex-1 max-h-[130px] w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
      />
    </div>
  )
}
