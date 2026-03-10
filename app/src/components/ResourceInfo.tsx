import { BarChart3, ChevronDown, Hash, Percent, Unplug } from 'lucide-react'
import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useProcessContext } from '@/context/ProcessContext'
import { useTerminalContext } from '@/context/TerminalContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import type { ActiveProcess } from '../../shared/types'
import { ResourceView, type ResourceViewMode } from './ResourceView'
import { ProcessItem } from './terminal-status-sections'

interface ResourceInfoProps {
  terminalId?: number
  shellId?: number
  className?: string
}

function computeUsage(
  usage: Record<number, { rss: number; cpu: number }>,
  shellIds: number[],
  totalRam: number,
  totalCpu: number,
) {
  let totalRss = 0
  let totalCpuUsage = 0
  for (const id of shellIds) {
    const u = usage[id]
    if (u) {
      totalRss += u.rss
      totalCpuUsage += u.cpu
    }
  }
  const memPercent = totalRam > 0 ? ((totalRss * 1024) / totalRam) * 100 : 0
  const cpuPercent = totalCpu > 0 ? totalCpuUsage / totalCpu : 0
  return { cpuPercent, memPercent, rssKb: totalRss }
}

export function ResourceInfo({
  terminalId,
  shellId,
  className,
}: ResourceInfoProps) {
  const { resourceInfo, processes } = useProcessContext()
  const { terminals } = useTerminalContext()
  const [mode, setMode] = useLocalStorage<ResourceViewMode>(
    'resource-view-mode',
    'bar',
  )

  const { totalRam, totalCpu, usage } = resourceInfo

  // No data available (e.g. process tree command errored out)
  if (totalRam === 0 || totalCpu === 0 || Object.keys(usage).length === 0) {
    return null
  }

  // Determine which shell IDs are in scope
  let scopeShellIds: number[]
  if (shellId !== undefined) {
    scopeShellIds = [shellId]
  } else if (terminalId !== undefined) {
    const terminal = terminals.find((t) => t.id === terminalId)
    scopeShellIds = terminal ? terminal.shells.map((s) => s.id) : []
  } else {
    scopeShellIds = Object.keys(usage).map(Number)
  }

  const aggregated = computeUsage(usage, scopeShellIds, totalRam, totalCpu)

  // Build grouped data for popover
  const scopeTerminals =
    terminalId !== undefined
      ? terminals.filter((t) => t.id === terminalId)
      : terminals

  // Index processes by shellId
  const processesByShell = new Map<number, ActiveProcess[]>()
  for (const p of processes) {
    if (p.shellId !== undefined) {
      const arr = processesByShell.get(p.shellId)
      if (arr) arr.push(p)
      else processesByShell.set(p.shellId, [p])
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('cursor-pointer', className)}>
          <ResourceView
            cpuPercent={aggregated.cpuPercent}
            memPercent={aggregated.memPercent}
            memRssKb={aggregated.rssKb}
            mode={mode}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-fit max-w-[95vw] min-w-[250px] max-h-[90vh] pt-[env(safe-area-inset-top)] p-3"
        align="center"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground">
            Resource Usage
          </span>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={mode}
            onValueChange={(v) => {
              if (v) setMode(v as ResourceViewMode)
            }}
          >
            <ToggleGroupItem value="bar" className="h-6 px-1.5">
              <BarChart3 className="w-3 h-3" />
            </ToggleGroupItem>
            <ToggleGroupItem value="percent" className="h-6 px-1.5">
              <Percent className="w-3 h-3" />
            </ToggleGroupItem>
            <ToggleGroupItem value="actual" className="h-6 px-1.5">
              <Hash className="w-3 h-3" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          {shellId !== undefined ? (
            <ShellRow
              shellId={shellId}
              terminalId={
                terminals.find((t) => t.shells.some((s) => s.id === shellId))
                  ?.id ?? 0
              }
              label={
                terminals.flatMap((t) => t.shells).find((s) => s.id === shellId)
                  ?.name ?? `shell-${shellId}`
              }
              usage={usage}
              totalRam={totalRam}
              totalCpu={totalCpu}
              mode={mode}
              processes={processesByShell.get(shellId) ?? []}
            />
          ) : (
            scopeTerminals.map((terminal) => {
              const termShellIds = terminal.shells.map((s) => s.id)
              const termUsage = computeUsage(
                usage,
                termShellIds,
                totalRam,
                totalCpu,
              )
              return (
                <div key={terminal.id}>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs font-medium truncate max-w-[180px]">
                      {terminal.name ?? `terminal-${terminal.id}`}
                    </span>
                    <ResourceView
                      cpuPercent={termUsage.cpuPercent}
                      memPercent={termUsage.memPercent}
                      memRssKb={termUsage.rssKb}
                      mode={mode}
                      className="scale-90 origin-right"
                    />
                  </div>
                  {terminal.shells.map((shell) => (
                    <ShellRow
                      key={shell.id}
                      shellId={shell.id}
                      terminalId={terminal.id}
                      label={shell.name}
                      usage={usage}
                      totalRam={totalRam}
                      totalCpu={totalCpu}
                      mode={mode}
                      processes={processesByShell.get(shell.id) ?? []}
                    />
                  ))}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ShellRow({
  shellId,
  terminalId,
  label,
  usage,
  totalRam,
  totalCpu,
  mode,
  processes,
}: {
  shellId: number
  terminalId: number
  label: string
  usage: Record<number, { rss: number; cpu: number }>
  totalRam: number
  totalCpu: number
  mode: ResourceViewMode
  processes: ActiveProcess[]
}) {
  const [expanded, setExpanded] = useState(false)
  const connected = shellId in usage
  const shellUsage = computeUsage(usage, [shellId], totalRam, totalCpu)
  const hasProcesses = processes.length > 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center justify-between py-0.5 pl-3',
          hasProcesses && 'cursor-pointer',
        )}
        onClick={hasProcesses ? () => setExpanded(!expanded) : undefined}
      >
        <span
          className={cn(
            'text-xs truncate max-w-[180px] flex items-center gap-1',
            connected ? 'text-muted-foreground' : 'text-muted-foreground/40',
            hasProcesses && '-translate-x-4',
          )}
        >
          {hasProcesses && (
            <ChevronDown
              className={cn(
                'w-3 h-3 transition-transform flex-shrink-0',
                !expanded && '-rotate-90',
              )}
            />
          )}
          {label}
        </span>
        {connected ? (
          <ResourceView
            cpuPercent={shellUsage.cpuPercent}
            memPercent={shellUsage.memPercent}
            memRssKb={shellUsage.rssKb}
            mode={mode}
            className="scale-90 origin-right"
          />
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
            <Unplug className="w-3 h-3" />
          </span>
        )}
      </div>
      {expanded &&
        processes.map((p) => (
          <div
            key={`${p.pid}-${p.command}`}
            className="pl-2 max-w-[500px] break-all"
          >
            <ProcessItem
              process={p}
              terminalId={terminalId}
              compact
              truncate={false}
            />
          </div>
        ))}
    </div>
  )
}
