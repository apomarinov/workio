import { Loader2 } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import type { PaletteItem as PaletteItemType } from './types'

type Props = {
  item: PaletteItemType
}

export function PaletteItem({ item }: Props) {
  return (
    <CommandItem
      className="cursor-pointer"
      value={item.id}
      keywords={item.keywords}
      disabled={item.disabled}
      onSelect={item.onSelect}
    >
      {item.icon}
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={
            item.disabled ? 'truncate text-zinc-500' : 'truncate font-medium'
          }
        >
          {item.label}
        </span>
        {item.description && (
          <div className="truncate text-xs text-zinc-500">
            {item.description}
          </div>
        )}
      </div>
      {item.disabledReason && (
        <span className="text-xs text-yellow-500/80">
          ({item.disabledReason})
        </span>
      )}
      {item.loading && (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
      )}
      {item.rightSlot}
    </CommandItem>
  )
}
