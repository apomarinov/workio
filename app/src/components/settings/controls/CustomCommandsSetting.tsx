import type { CustomTerminalAction } from '@domains/settings/schema'
import { Github, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { MobileKeyboardCustomAction } from '@/components/MobileKeyboardCustomAction'
import { useSettingsView } from '../SettingsViewContext'

export function CustomCommandsSetting() {
  const { getFormValue, setFormValue } = useSettingsView()
  const actions =
    (getFormValue('custom_terminal_actions') as
      | CustomTerminalAction[]
      | undefined) ?? []

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<
    CustomTerminalAction | undefined
  >()

  const handleSave = (action: CustomTerminalAction) => {
    if (editingAction) {
      setFormValue(
        'custom_terminal_actions',
        actions.map((a) => (a.id === action.id ? action : a)),
      )
    } else {
      setFormValue('custom_terminal_actions', [...actions, action])
    }
    setDialogOpen(false)
    setEditingAction(undefined)
  }

  const handleDelete = (id: string) => {
    setFormValue(
      'custom_terminal_actions',
      actions.filter((a) => a.id !== id),
    )
  }

  const handleEdit = (action: CustomTerminalAction) => {
    setEditingAction(action)
    setDialogOpen(true)
  }

  const handleAdd = () => {
    setEditingAction(undefined)
    setDialogOpen(true)
  }

  return (
    <>
      <div className="space-y-1 w-full">
        {actions.length === 0 ? (
          <div className="text-xs text-muted-foreground/60 italic">
            No custom commands
          </div>
        ) : (
          (() => {
            const grouped = new Map<string, CustomTerminalAction[]>()
            for (const action of actions) {
              const group = action.repo || 'Global'
              const list = grouped.get(group) ?? []
              list.push(action)
              grouped.set(group, list)
            }
            const entries = Array.from(grouped.entries()).sort(([a], [b]) =>
              a === 'Global' ? -1 : b === 'Global' ? 1 : a.localeCompare(b),
            )
            return entries.map(([repo, groupActions]) => (
              <div key={repo} className="space-y-1">
                <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                  {repo !== 'Global' && <Github className="w-3 h-3" />}
                  {repo}
                </div>
                {groupActions.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center justify-between gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{action.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        <code>{action.command}</code>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEdit(action)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(action.id)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          })()
        )}
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer mt-2"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Command
        </button>
      </div>

      <MobileKeyboardCustomAction
        open={dialogOpen}
        initialAction={editingAction}
        onSave={handleSave}
        onClose={() => {
          setDialogOpen(false)
          setEditingAction(undefined)
        }}
      />
    </>
  )
}
