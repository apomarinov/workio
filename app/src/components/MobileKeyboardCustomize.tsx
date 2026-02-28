import { ArrowDown, ArrowUp, Minus, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buildActionsMap } from '@/lib/terminalActions'
import { cn } from '@/lib/utils'
import type { CustomTerminalAction, MobileKeyboardRow } from '../types'
import { MobileKeyboardNewGroup } from './MobileKeyboardNewGroup'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

interface MobileKeyboardCustomizeProps {
  open: boolean
  rows: MobileKeyboardRow[]
  customActions: CustomTerminalAction[]
  onSave: (rows: MobileKeyboardRow[]) => void
  onCustomActionCreated: (action: CustomTerminalAction) => void
  onCustomActionUpdated: (action: CustomTerminalAction) => void
  onCustomActionDeleted: (actionId: string) => void
  onClose: () => void
}

export function MobileKeyboardCustomize({
  open,
  rows,
  customActions,
  onSave,
  onCustomActionCreated,
  onCustomActionUpdated,
  onCustomActionDeleted,
  onClose,
}: MobileKeyboardCustomizeProps) {
  const [localRows, setLocalRows] = useState<MobileKeyboardRow[]>(rows)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const actionsMap = buildActionsMap(customActions)

  // Sync local state when dialog opens (programmatic open doesn't fire onOpenChange)
  useEffect(() => {
    if (open) {
      setLocalRows(rows)
    }
  }, [open, rows])

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose()
    }
  }

  const moveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= localRows.length) return
    const next = [...localRows]
    ;[next[index], next[target]] = [next[target], next[index]]
    setLocalRows(next)
  }

  const deleteRow = (index: number) => {
    setLocalRows((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddGroup = (newRow: MobileKeyboardRow) => {
    if (editingIndex !== null) {
      setLocalRows((prev) =>
        prev.map((row, i) =>
          i === editingIndex ? { ...row, actions: newRow.actions } : row,
        ),
      )
      setEditingIndex(null)
    } else {
      setLocalRows((prev) => [...prev, newRow])
    }
    setNewGroupOpen(false)
  }

  const handleEditGroup = (index: number) => {
    setEditingIndex(index)
    setNewGroupOpen(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between px-4 pt-4 pb-2 space-y-0">
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
            <DialogTitle className="text-base font-semibold">
              Customize Keyboard
            </DialogTitle>
            <button
              type="button"
              onClick={() => setNewGroupOpen(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-5 h-5" />
            </button>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 space-y-3">
            {/* Preview of all actions */}
            {localRows.length > 0 && (
              <div className="flex gap-1 px-1 overflow-x-auto">
                {localRows.flatMap((row) =>
                  row.actions.map((actionId) => {
                    const action = actionsMap[actionId]
                    if (!action) return null
                    return (
                      <div
                        key={`preview-${row.id}-${actionId}`}
                        className="flex-shrink-0 px-2 py-2 min-w-10 rounded bg-zinc-700/60 text-center text-xs text-zinc-300"
                      >
                        {action.label}
                      </div>
                    )
                  }),
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Reorder the group buttons below to determine which keys appear in
              your terminal keyboard.
            </p>

            {/* Row list */}
            <div className="space-y-1">
              {localRows.map((row, index) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-lg bg-zinc-800/50 px-2 py-0.5"
                >
                  <button
                    type="button"
                    onClick={() => deleteRow(index)}
                    className="text-red-400 hover:text-red-300 flex-shrink-0"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditGroup(index)}
                    className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex-1 min-w-0 flex gap-1 overflow-x-auto">
                    {row.actions.map((actionId, i) => {
                      const action = actionsMap[actionId]
                      return (
                        <div
                          key={`${row.id}-${actionId}-${i}`}
                          className="flex-shrink-0 px-2 py-1 min-w-8 text-center rounded bg-zinc-700/60 text-xs text-zinc-300"
                        >
                          {action?.label ?? actionId}
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => moveRow(index, -1)}
                      disabled={index === 0}
                      className={cn(
                        'text-muted-foreground',
                        index === 0 ? 'opacity-30' : 'hover:text-foreground',
                      )}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(index, 1)}
                      disabled={index === localRows.length - 1}
                      className={cn(
                        'text-muted-foreground',
                        index === localRows.length - 1
                          ? 'opacity-30'
                          : 'hover:text-foreground',
                      )}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onSave(localRows)}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 active:bg-blue-700"
            >
              Save
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <MobileKeyboardNewGroup
        open={newGroupOpen}
        title={editingIndex !== null ? 'Edit Group' : 'New Group'}
        initialActions={
          editingIndex !== null ? localRows[editingIndex]?.actions : undefined
        }
        customActions={customActions}
        onSave={handleAddGroup}
        onCustomActionCreated={onCustomActionCreated}
        onCustomActionUpdated={onCustomActionUpdated}
        onCustomActionDeleted={onCustomActionDeleted}
        onClose={() => {
          setNewGroupOpen(false)
          setEditingIndex(null)
        }}
      />
    </>
  )
}
