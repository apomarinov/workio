import type {
  CustomTerminalAction,
  MobileKeyboardRow,
} from '@domains/settings/schema'
import { ArrowDown, ArrowUp, Minus, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { MobileKeyboardNewGroup } from '@/components/MobileKeyboardNewGroup'
import { buildActionsMap, DEFAULT_KEYBOARD_ROWS } from '@/lib/terminalActions'
import { cn } from '@/lib/utils'
import { useSettingsView } from '../SettingsViewContext'

export function MobileKeyboardSetting() {
  const { getFormValue, setFormValue } = useSettingsView()

  const rows =
    (getFormValue('mobile_keyboard_rows') as MobileKeyboardRow[] | undefined) ??
    DEFAULT_KEYBOARD_ROWS
  const customActions =
    (getFormValue('custom_terminal_actions') as
      | CustomTerminalAction[]
      | undefined) ?? []
  const actionsMap = buildActionsMap(customActions)

  const [localRows, setLocalRows] = useState<MobileKeyboardRow[]>(rows)
  const [newGroupOpen, setNewGroupOpen] = useState<'new-action' | boolean>(
    false,
  )
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  useEffect(() => {
    setLocalRows(rows)
  }, [rows])

  const syncRows = (next: MobileKeyboardRow[]) => {
    setLocalRows(next)
    setFormValue('mobile_keyboard_rows', next)
  }

  const moveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= localRows.length) return
    const next = [...localRows]
    ;[next[index], next[target]] = [next[target], next[index]]
    syncRows(next)
  }

  const deleteRow = (index: number) => {
    syncRows(localRows.filter((_, i) => i !== index))
  }

  const handleAddGroup = (newRow: MobileKeyboardRow) => {
    if (editingIndex !== null) {
      syncRows(
        localRows.map((row, i) =>
          i === editingIndex ? { ...row, actions: newRow.actions } : row,
        ),
      )
      setEditingIndex(null)
    } else {
      syncRows([...localRows, newRow])
    }
    setNewGroupOpen(false)
  }

  const handleEditGroup = (index: number) => {
    setEditingIndex(index)
    setNewGroupOpen(true)
  }

  const handleCustomActionCreated = (action: CustomTerminalAction) => {
    setFormValue('custom_terminal_actions', [...customActions, action])
  }

  const handleCustomActionUpdated = (action: CustomTerminalAction) => {
    setFormValue(
      'custom_terminal_actions',
      customActions.map((a) => (a.id === action.id ? action : a)),
    )
  }

  const handleCustomActionDeleted = (actionId: string) => {
    setFormValue(
      'custom_terminal_actions',
      customActions.filter((a) => a.id !== actionId),
    )
  }

  return (
    <>
      <div className="w-full space-y-3">
        {/* Preview of all actions */}
        {localRows.length > 0 && (
          <div className="flex gap-1 overflow-x-auto">
            {localRows.flatMap((row) =>
              row.actions.map((actionId) => {
                const action = actionsMap[actionId]
                if (!action) return null
                return (
                  <ActionButton
                    key={`preview-${row.id}-${actionId}`}
                    label={action.label}
                    className="flex-shrink-0"
                  />
                )
              }),
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Reorder the group buttons below to determine which keys appear in your
          terminal keyboard.
        </p>

        {/* Row list */}
        <div className="space-y-1">
          {localRows.map((row, index) => (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded-lg bg-sidebar px-2 py-1"
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
                {row.actions.map((actionId, i) => (
                  <ActionButton
                    key={`${row.id}-${actionId}-${i}`}
                    label={actionsMap[actionId]?.label ?? actionId}
                    className="flex-shrink-0 min-w-10"
                  />
                ))}
              </div>
              <div className="flex gap-2 flex-shrink-0">
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
          onClick={() => setNewGroupOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Group
        </button>
      </div>

      <MobileKeyboardNewGroup
        open={newGroupOpen}
        title={editingIndex !== null ? 'Edit Group' : 'New Group'}
        initialActions={
          editingIndex !== null ? localRows[editingIndex]?.actions : undefined
        }
        customActions={customActions}
        onSave={handleAddGroup}
        onCustomActionCreated={handleCustomActionCreated}
        onCustomActionUpdated={handleCustomActionUpdated}
        onCustomActionDeleted={handleCustomActionDeleted}
        onClose={() => {
          setNewGroupOpen(false)
          setEditingIndex(null)
        }}
      />
    </>
  )
}
