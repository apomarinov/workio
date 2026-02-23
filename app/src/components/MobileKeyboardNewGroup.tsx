import { Check, Delete, X } from 'lucide-react'
import { useState } from 'react'
import { ACTIONS, ALL_ACTIONS } from '@/lib/terminalActions'
import { cn } from '@/lib/utils'
import type { MobileKeyboardRow } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

const CATEGORY_LABELS: Record<string, string> = {
  modifier: 'Modifiers',
  special: 'Special',
  ctrl: 'Ctrl Combos',
  nav: 'Navigation',
  symbol: 'Symbols',
  function: 'Function Keys',
}

const CATEGORY_ORDER = [
  'modifier',
  'special',
  'ctrl',
  'nav',
  'symbol',
  'function',
]

interface MobileKeyboardNewGroupProps {
  open: boolean
  onSave: (row: MobileKeyboardRow) => void
  onClose: () => void
}

export function MobileKeyboardNewGroup({
  open,
  onSave,
  onClose,
}: MobileKeyboardNewGroupProps) {
  const [selected, setSelected] = useState<string[]>([])

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setSelected([])
    } else {
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
      id: crypto.randomUUID(),
      actions: selected,
    })
    setSelected([])
  }

  // Group actions by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    actions: ALL_ACTIONS.filter((a) => a.category === cat),
  }))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between px-4 pt-4 pb-2 space-y-0">
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
          <DialogTitle className="text-base font-semibold">
            New Group
          </DialogTitle>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected.length === 0}
            className={cn(
              'text-muted-foreground',
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
          <div className="flex items-center gap-1 min-h-[32px] px-2 py-1 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
            {selected.length === 0 ? (
              <span className="text-xs text-muted-foreground/50">
                Tap actions below (max 8)
              </span>
            ) : (
              selected.map((actionId) => {
                const action = ACTIONS[actionId]
                return (
                  <button
                    key={`sel-${actionId}`}
                    type="button"
                    onClick={() => toggleAction(actionId)}
                    className="px-2 py-0.5 rounded bg-blue-600/80 text-white text-xs font-medium"
                  >
                    {action?.label ?? actionId}
                  </button>
                )
              })
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
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="text-xs font-medium text-muted-foreground/70 mb-1">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1">
                {group.actions.map((action) => {
                  const isSelected = selected.includes(action.id)
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => toggleAction(action.id)}
                      className={cn(
                        'px-2 py-1 rounded text-xs font-medium transition-colors',
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-700/60 text-zinc-300 active:bg-zinc-600',
                        selected.length >= 8 && !isSelected && 'opacity-40',
                      )}
                    >
                      {action.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
