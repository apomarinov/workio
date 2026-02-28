import { cn } from '@/lib/utils'
import type { FileStatus } from '../../shared/types'

export const STATUS_CONFIG: Record<
  FileStatus,
  { label: string; className: string }
> = {
  added: { label: 'A', className: 'bg-green-900/50 text-green-400' },
  modified: { label: 'M', className: 'bg-blue-900/50 text-blue-400' },
  deleted: { label: 'D', className: 'bg-red-900/50 text-red-400' },
  renamed: { label: 'R', className: 'bg-yellow-900/50 text-yellow-400' },
  untracked: { label: 'U', className: 'bg-zinc-700/50 text-zinc-400' },
}

export function FileStatusBadge({ status }: { status: FileStatus }) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded text-xs font-mono font-semibold',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}
