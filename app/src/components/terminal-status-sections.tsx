import {
  Activity,
  ChevronDown,
  ExternalLink,
  Globe,
  Link,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSocket } from '@/hooks/useSocket'
import { formatTimeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { ActiveProcess } from '../../shared/types'
import type { Shell } from '../types'

interface GitDirtyBadgeProps {
  added: number
  removed: number
  untracked: number
  untrackedLines?: number
  className?: string
}

export function GitDirtyBadge({
  added,
  removed,
  untracked,
  untrackedLines = 0,
  className,
}: GitDirtyBadgeProps) {
  const totalAdded = added + untrackedLines
  return (
    <div className={cn('font-mono flex gap-1 items-center', className)}>
      {totalAdded > 0 && (
        <span className="text-green-500/80">+{totalAdded}</span>
      )}
      {removed > 0 && <span className="text-red-400/80">-{removed}</span>}
      {untracked > 0 && (
        <span className="text-yellow-500/80">?{untracked}</span>
      )}
    </div>
  )
}

interface ProcessItemProps {
  process: {
    pid: number
    command: string
    startedAt?: string | number
    isZellij?: boolean
  }
  terminalId: number
  compact?: boolean
  truncate?: boolean
}

export function ProcessItem({
  process,
  terminalId,
  compact,
  truncate = true,
}: ProcessItemProps) {
  const { emit } = useSocket()
  const isMobile = useIsMobile()

  return (
    <div
      className={cn(
        'group/proc flex items-center gap-2 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-sidebar-accent/30 transition-colors',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
      )}
    >
      <Activity className="w-3 h-3 flex-shrink-0 text-green-500/70" />
      <span className={cn('text-xs w-fit', truncate && 'truncate')}>
        {process.command}
      </span>
      <span className="flex-shrink-0 ml-auto flex items-center gap-0.5">
        {process.startedAt && (
          <span
            className={cn(
              'text-[10px] text-muted-foreground/40',
              !isMobile && 'group-hover/proc:hidden',
            )}
          >
            {formatTimeAgo(process.startedAt)}
          </span>
        )}
        {process.isZellij && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              emit('zellij-attach', { terminalId })
            }}
            className={cn(
              isMobile ? 'block' : 'hidden group-hover/proc:block',
              'text-muted-foreground/60 hover:text-foreground/90 group-hover/proc:text-muted-foreground/80 transition-colors cursor-pointer',
            )}
          >
            <Link className="w-3 h-3" />
          </button>
        )}
        {process.pid > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              emit('kill-process', { pid: process.pid })
              toast.success('Process killed')
            }}
            className={cn(
              isMobile ? 'block' : 'hidden group-hover/proc:block',
              'text-muted-foreground/60 group-hover/proc:text-muted-foreground/80 hover:text-red-400/90 transition-colors cursor-pointer',
            )}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    </div>
  )
}

interface PortItemProps {
  port: number
  compact?: boolean
  onClick?: () => void
}

export function PortItem({ port, compact, onClick }: PortItemProps) {
  const isMobile = useIsMobile()

  return (
    <a
      href={`http://localhost:${port}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onClick?.()}
      className={cn(
        'flex items-center group/port gap-2 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
      )}
    >
      <Globe className="w-3 h-3 flex-shrink-0 text-blue-400" />
      <span className="text-xs">{port}</span>
      <ExternalLink
        className={cn(
          'w-3 h-3 flex-shrink-0 ml-auto',
          isMobile ? 'block' : 'hidden group-hover/port:block',
        )}
      />
    </a>
  )
}

interface ProcessesListProps {
  processes: ActiveProcess[]
  shells: Shell[]
  terminalId: number
  terminalName: string | null
  compact?: boolean
}

export function ProcessesList({
  processes,
  shells,
  terminalId,
  terminalName,
  compact,
}: ProcessesListProps) {
  const [collapsedShells, setCollapsedShells] = useState<Set<number>>(new Set())

  const grouped = new Map<number, ActiveProcess[]>()
  for (const p of processes) {
    const sid = p.shellId ?? 0
    const arr = grouped.get(sid)
    if (arr) arr.push(p)
    else grouped.set(sid, [p])
  }
  const shellEntries = shells
    .filter((s) => grouped.has(s.id))
    .map((s) => ({ shell: s, procs: grouped.get(s.id)! }))
  const ungrouped = grouped.get(0)

  const toggleShell = (id: number) => {
    setCollapsedShells((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      {shellEntries.map(({ shell: sh, procs }) => {
        const isCollapsed = collapsedShells.has(sh.id)
        return (
          <div key={sh.id}>
            <button
              type="button"
              onClick={() => toggleShell(sh.id)}
              className="flex cursor-pointer w-full items-center gap-1 text-[10px] tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 pt-1"
            >
              <ChevronDown
                className={cn(
                  'w-3 h-3 transition-transform',
                  isCollapsed && '-rotate-90',
                )}
              />
              {sh.name === 'main' ? (terminalName ?? sh.name) : sh.name} (
              {procs.length})
            </button>
            {!isCollapsed &&
              procs.map((process) => (
                <ProcessItem
                  key={`${process.pid}-${process.command}`}
                  process={process}
                  terminalId={terminalId}
                  compact={compact}
                />
              ))}
          </div>
        )
      })}
      {ungrouped?.map((process) => (
        <ProcessItem
          key={`${process.pid}-${process.command}`}
          process={process}
          terminalId={terminalId}
          compact={compact}
        />
      ))}
    </>
  )
}

interface PortsListProps {
  shellPorts: Record<number, number[]>
  terminalPorts: number[]
  shells: Shell[]
  terminalName: string | null
  compact?: boolean
  onClick?: () => void
}

export function PortsList({
  shellPorts,
  terminalPorts,
  shells,
  terminalName,
  compact,
  onClick,
}: PortsListProps) {
  const [collapsedShells, setCollapsedShells] = useState<Set<number>>(new Set())

  const shellEntries = shells
    .filter((s) => shellPorts[s.id]?.length > 0)
    .map((s) => ({ shell: s, ports: shellPorts[s.id] }))
  const hasShellGrouping = shellEntries.length > 0

  const toggleShell = (id: number) => {
    setCollapsedShells((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!hasShellGrouping) {
    return (
      <>
        {terminalPorts.map((port) => (
          <PortItem key={port} port={port} compact={compact} />
        ))}
      </>
    )
  }

  return (
    <>
      {shellEntries.map(({ shell: sh, ports: sPorts }) => {
        const isCollapsed = collapsedShells.has(sh.id)
        return (
          <div key={sh.id}>
            <button
              type="button"
              onClick={() => toggleShell(sh.id)}
              className="flex cursor-pointer w-full items-center gap-1 text-[10px] tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 pt-1"
            >
              <ChevronDown
                className={cn(
                  'w-3 h-3 transition-transform',
                  isCollapsed && '-rotate-90',
                )}
              />
              {sh.name === 'main' ? (terminalName ?? sh.name) : sh.name} (
              {sPorts.length})
            </button>
            {!isCollapsed &&
              sPorts.map((port) => (
                <div key={port} className="ml-2">
                  <PortItem port={port} compact={compact} onClick={onClick} />
                </div>
              ))}
          </div>
        )
      })}
    </>
  )
}
