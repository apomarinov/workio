import type { Modifiers, TerminalAction } from '@/lib/terminalActions'
import type { MobileKeyboardRow } from '../types'
import { ActionChip } from './ActionChip'

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
              <ActionChip
                key={`${row.id}-${actionId}-${i}`}
                label={action.label}
                active={isActive}
                size="lg"
                preventFocusLoss
                onTap={() => onActionTap(actionId)}
                className="flex-1 min-w-0 max-w-[220px]"
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
