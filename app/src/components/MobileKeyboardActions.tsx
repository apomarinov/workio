import type { Modifiers, TerminalAction } from '@/lib/terminalActions'
import { cn } from '@/lib/utils'
import type { MobileKeyboardRow } from '../types'

interface MobileKeyboardActionsProps {
  rows: MobileKeyboardRow[]
  activeModifiers: Modifiers
  allActions: Record<string, TerminalAction>
  onActionTap: (actionId: string) => void
}

export function MobileKeyboardActions({
  rows,
  activeModifiers,
  allActions,
  onActionTap,
}: MobileKeyboardActionsProps) {
  return (
    <div className="max-h-[20vh] overflow-y-auto p-1.5 space-y-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex gap-1">
          {row.actions.map((actionId, i) => {
            const action = allActions[actionId]
            if (!action) return null
            const isModifier = action.isModifier === true
            const isActive =
              isModifier && activeModifiers[actionId as keyof Modifiers]
            return (
              <button
                key={`${row.id}-${actionId}-${i}`}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onPointerUp={() => onActionTap(actionId)}
                className={cn(
                  'flex-1 min-w-0 py-1.5 rounded-md truncate max-w-[220px] text-base font-medium transition-colors select-none',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-700/80 text-zinc-200 active:bg-zinc-600',
                )}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
