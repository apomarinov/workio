import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface ItemAction {
  icon: ReactNode
  label?: string
  onClick: () => void
  className?: string
}

function ActionButton({ action }: { action: ItemAction }) {
  return (
    <Button
      variant="ghost"
      size={action.label ? 'xs' : 'icon-xs'}
      className={cn('hover:!bg-zinc-700', action.className)}
      onClick={action.onClick}
    >
      {action.icon}
      {action.label && <span>{action.label}</span>}
    </Button>
  )
}

export function ItemActions({ actions }: { actions: ItemAction[] }) {
  if (actions.length === 0) return null

  if (actions.length === 1) {
    return (
      <div
        className="flex items-center"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <ActionButton action={actions[0]} />
      </div>
    )
  }

  return (
    <div
      className="flex items-center"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="hover:!bg-zinc-700">
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-auto min-w-[140px] p-1 flex flex-col gap-0.5"
        >
          {actions.map((action) => (
            <PopoverClose asChild key={action.label ?? action.className}>
              <ActionButton action={action} />
            </PopoverClose>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
