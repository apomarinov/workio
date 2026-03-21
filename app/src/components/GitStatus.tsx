import type { GitDiffStat, GitRemoteSyncStat } from '@domains/pty/schema'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { GitDirtyBadge } from './terminal-status-sections'

interface GitStatusProps {
  terminalId: number
  diffStat: GitDiffStat | null
  remoteSyncStat?: GitRemoteSyncStat
  className?: string
  badgeClassName?: string
}

export function GitStatus({
  terminalId,
  diffStat,
  remoteSyncStat,
  className,
  badgeClassName,
}: GitStatusProps) {
  const isDirty =
    !!diffStat &&
    (diffStat.added > 0 || diffStat.removed > 0 || diffStat.untracked > 0)
  const showRemoteSync =
    !!remoteSyncStat &&
    (remoteSyncStat.noRemote ||
      remoteSyncStat.behind > 0 ||
      remoteSyncStat.ahead > 0)

  if (!isDirty && !showRemoteSync) return null

  return (
    <span className={cn('flex items-center gap-1', className)}>
      {isDirty && diffStat && (
        <DirtyBadge
          diffStat={diffStat}
          terminalId={terminalId}
          className={badgeClassName}
        />
      )}
      {showRemoteSync && remoteSyncStat && (
        <RemoteSyncBadge stat={remoteSyncStat} />
      )}
    </span>
  )
}

function DirtyBadge({
  diffStat,
  terminalId,
  className,
}: {
  diffStat: GitDiffStat
  terminalId: number
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        window.dispatchEvent(
          new CustomEvent('open-commit-dialog', {
            detail: { terminalId },
          }),
        )
      }}
      className="cursor-pointer"
    >
      <GitDirtyBadge
        added={diffStat.added}
        removed={diffStat.removed}
        untracked={diffStat.untracked}
        untrackedLines={diffStat.untrackedLines}
        className={className}
      />
    </button>
  )
}

function RemoteSyncBadge({ stat }: { stat: GitRemoteSyncStat }) {
  if (stat.noRemote) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex gap-0 group/norem">
            <ArrowDown className="w-3 h-3 text-yellow-500/80 group-hover/norem:text-yellow-500" />
            <ArrowUp className="w-3 h-3 text-yellow-500/80 group-hover/norem:text-yellow-500 translate-x-[-3px]" />
          </div>
        </TooltipTrigger>
        <TooltipContent>No remote configured</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className="text-[11px] font-mono flex items-center gap-1">
      {stat.behind > 0 && <SyncCount count={stat.behind} direction="behind" />}
      {stat.ahead > 0 && <SyncCount count={stat.ahead} direction="ahead" />}
    </span>
  )
}

function SyncCount({
  count,
  direction,
}: {
  count: number
  direction: 'ahead' | 'behind'
}) {
  const colorClass =
    direction === 'behind' ? 'text-blue-500/80' : 'text-green-500/80'
  const hoverClass =
    direction === 'behind' ? 'hover:text-blue-500' : 'hover:text-green-500'
  const Arrow = direction === 'behind' ? ArrowDown : ArrowUp
  const label = `${count} commit${count > 1 ? 's' : ''} ${direction === 'behind' ? 'behind' : 'ahead of'} remote`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('flex items-center', colorClass, hoverClass)}>
          {count}
          <Arrow className="w-3 h-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
