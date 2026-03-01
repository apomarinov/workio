import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, Delete, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ALL_ACTIONS, buildActionsMap } from '@/lib/terminalActions'
import { cn } from '@/lib/utils'
import type { CustomTerminalAction, MobileKeyboardRow } from '../types'
import { ActionChip } from './ActionChip'
import { ConfirmModal } from './ConfirmModal'
import { MobileKeyboardCustomAction } from './MobileKeyboardCustomAction'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

function SortableChip({
  actionId,
  label,
  onRemove,
}: {
  actionId: string
  label: string
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: actionId })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={onRemove}
      className="px-2.5 py-2 min-w-10 rounded bg-blue-600/80 text-white text-xs font-medium touch-manipulation"
    >
      {label}
    </button>
  )
}

const CATEGORY_LABELS: Record<string, string> = {
  modifier: 'Modifiers',
  special: 'Special',
  ctrl: 'Ctrl Combos',
  nav: 'Navigation',
  symbol: 'Symbols',
  function: 'Function Keys',
  custom: 'Custom Commands',
}

const CATEGORY_ORDER = [
  'custom',
  'modifier',
  'special',
  'ctrl',
  'nav',
  'symbol',
  'function',
]

interface MobileKeyboardNewGroupProps {
  open: boolean | 'new-action'
  title?: string
  initialActions?: string[]
  customActions: CustomTerminalAction[]
  onSave: (row: MobileKeyboardRow) => void
  onCustomActionCreated: (action: CustomTerminalAction) => void
  onCustomActionUpdated: (action: CustomTerminalAction) => void
  onCustomActionDeleted: (actionId: string) => void
  onClose: () => void
}

export function MobileKeyboardNewGroup({
  open,
  title = 'New Group',
  initialActions,
  customActions,
  onSave,
  onCustomActionCreated,
  onCustomActionUpdated,
  onCustomActionDeleted,
  onClose,
}: MobileKeyboardNewGroupProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [customActionOpen, setCustomActionOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<
    CustomTerminalAction | undefined
  >()
  const [deletingAction, setDeletingAction] = useState<
    CustomTerminalAction | undefined
  >()

  const actionsMap = buildActionsMap(customActions)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  useEffect(() => {
    if (open) {
      setSelected(initialActions ?? [])
    }
  }, [open])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = selected.indexOf(active.id as string)
    const newIndex = selected.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...selected]
    next.splice(oldIndex, 1)
    next.splice(newIndex, 0, active.id as string)
    setSelected(next)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose()
    }
  }

  const toggleAction = (actionId: string) => {
    setSelected((prev) => {
      if (prev.includes(actionId)) {
        return prev.filter((id) => id !== actionId)
      }
      if (prev.length >= 8) return prev
      return [...prev, actionId]
    })
  }

  const removeLastSelected = () => {
    setSelected((prev) => prev.slice(0, -1))
  }

  const handleConfirm = () => {
    if (selected.length === 0) return
    onSave({
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actions: selected,
    })
    setSelected([])
  }

  const handleCustomActionSaved = (action: CustomTerminalAction) => {
    if (editingAction) {
      onCustomActionUpdated(action)
      setEditingAction(undefined)
    } else {
      onCustomActionCreated(action)
    }
    setCustomActionOpen(false)
  }

  // Build custom TerminalAction entries from custom actions
  const customTerminalActions = customActions.map((ca) => ({
    id: ca.id,
    label: ca.label,
    sequence: ca.command,
    category: 'custom' as const,
    repo: ca.repo,
  }))

  // Group custom actions by repo
  const customByRepo: {
    repo: string | undefined
    actions: typeof customTerminalActions
  }[] = []
  for (const ca of customTerminalActions) {
    let group = customByRepo.find((g) => g.repo === ca.repo)
    if (!group) {
      group = { repo: ca.repo, actions: [] }
      customByRepo.push(group)
    }
    group.actions.push(ca)
  }
  // Sort: no-repo first, then alphabetical by repo
  customByRepo.sort((a, b) => {
    if (!a.repo && b.repo) return -1
    if (a.repo && !b.repo) return 1
    return (a.repo ?? '').localeCompare(b.repo ?? '')
  })

  // Group actions by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    actions:
      cat === 'custom'
        ? customTerminalActions
        : ALL_ACTIONS.filter((a) => a.category === cat),
  }))

  return (
    <>
      <Dialog open={!!open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[70vh] flex flex-col p-0">
          <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between px-4 pt-4 pb-2 space-y-0">
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
            <DialogTitle className="text-base font-semibold">
              {title}
            </DialogTitle>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selected.length === 0}
              className={cn(
                'p-1 text-muted-foreground',
                selected.length > 0
                  ? 'hover:text-foreground text-green-400'
                  : 'opacity-40',
              )}
            >
              <Check className="w-5 h-5" />
            </button>
          </DialogHeader>

          {/* Selected actions preview */}
          <div className="flex-shrink-0 px-4 pb-2">
            <div className="flex flex-wrap items-center gap-1 min-h-[32px] px-2 py-1 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
              {selected.length === 0 ? (
                <span className="text-xs text-muted-foreground/50">
                  Tap actions below (max 8)
                </span>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToParentElement]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={selected}
                    strategy={rectSortingStrategy}
                  >
                    {selected.map((actionId) => {
                      const action = actionsMap[actionId]
                      return (
                        <SortableChip
                          key={`sel-${actionId}`}
                          actionId={actionId}
                          label={action?.label ?? actionId}
                          onRemove={() => toggleAction(actionId)}
                        />
                      )
                    })}
                  </SortableContext>
                </DndContext>
              )}
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={removeLastSelected}
                  className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  <Delete className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground/50 mt-1">
              {selected.length}/8
            </div>
          </div>

          {/* All actions grouped by category */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 space-y-3">
            {grouped.map((group) => (
              <div
                key={group.category}
                className={cn(
                  group.category === 'custom' &&
                    open === 'new-action' &&
                    'border-1 px-2 py-1 pt-2 border-blue-500 rounded-md animate-pulse',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xs font-medium text-muted-foreground/70">
                    {group.label}
                  </div>
                  {group.category === 'custom' && (
                    <button
                      type="button"
                      onClick={() => setCustomActionOpen(true)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {group.category === 'custom' ? (
                  <div className="space-y-2">
                    {customByRepo.map((repoGroup) => (
                      <div key={repoGroup.repo ?? '_general'}>
                        {customByRepo.length > 1 && (
                          <div className="text-[10px] font-medium text-muted-foreground/50 mb-1">
                            {repoGroup.repo
                              ? repoGroup.repo.split('/').pop()
                              : 'General'}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3">
                          {repoGroup.actions.map((action) => {
                            const isSelected = selected.includes(action.id)
                            const customAction = customActions.find(
                              (ca) => ca.id === action.id,
                            )
                            return (
                              <div
                                key={action.id}
                                className="flex items-center gap-0.5"
                              >
                                <ActionChip
                                  label={action.label}
                                  active={isSelected}
                                  dimmed={selected.length >= 8 && !isSelected}
                                  onTap={() => toggleAction(action.id)}
                                />
                                {customAction && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingAction(customAction)
                                        setCustomActionOpen(true)
                                      }}
                                      className="text-muted-foreground hover:text-foreground p-0.5"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeletingAction(customAction)
                                      }
                                      className="text-red-400 hover:text-red-300 p-0.5"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {group.actions.map((action) => {
                      const isSelected = selected.includes(action.id)
                      return (
                        <ActionChip
                          key={action.id}
                          label={action.label}
                          active={isSelected}
                          dimmed={selected.length >= 8 && !isSelected}
                          onTap={() => toggleAction(action.id)}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <MobileKeyboardCustomAction
        open={customActionOpen}
        initialAction={editingAction}
        onSave={handleCustomActionSaved}
        onClose={() => {
          setCustomActionOpen(false)
          setEditingAction(undefined)
        }}
      />
      <ConfirmModal
        open={!!deletingAction}
        title="Delete Custom Action"
        message={`Delete "${deletingAction?.label}"? This will also remove it from any groups that use it.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deletingAction) {
            setSelected((prev) => prev.filter((id) => id !== deletingAction.id))
            onCustomActionDeleted(deletingAction.id)
          }
          setDeletingAction(undefined)
        }}
        onCancel={() => setDeletingAction(undefined)}
      />
    </>
  )
}
