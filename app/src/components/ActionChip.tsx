import { cn } from '@/lib/utils'

interface ActionChipProps {
  label: string
  active?: boolean
  dimmed?: boolean
  size?: 'sm' | 'lg'
  preventFocusLoss?: boolean
  onTap?: () => void
  className?: string
}

export function ActionChip({
  label,
  active,
  dimmed,
  size = 'sm',
  preventFocusLoss,
  onTap,
  className,
}: ActionChipProps) {
  const isLg = size === 'lg'
  const classes = cn(
    'min-w-10 truncate text-center font-medium',
    isLg
      ? 'px-2 py-1.5 rounded-md text-base select-none'
      : 'px-2.5 py-2 rounded text-xs',
    active
      ? 'bg-blue-600 text-white'
      : cn(
          isLg
            ? 'bg-zinc-700/80 text-zinc-200'
            : 'bg-zinc-700/60 text-zinc-300',
          onTap && 'active:bg-zinc-600',
        ),
    onTap && 'transition-colors',
    dimmed && 'opacity-40',
    className,
  )

  if (!onTap) {
    return <div className={classes}>{label}</div>
  }

  return (
    <button
      type="button"
      onPointerDown={preventFocusLoss ? (e) => e.preventDefault() : undefined}
      onPointerUp={preventFocusLoss ? onTap : undefined}
      onClick={preventFocusLoss ? undefined : onTap}
      className={classes}
    >
      {label}
    </button>
  )
}
