import { Percent, Unplug } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useProcessContext } from '@/context/ProcessContext'
import { useTerminalContext } from '@/context/TerminalContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import { ResourceView } from './ResourceView'

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
  return { cpuPercent, memPercent }
}

export function ResourceInfo({
  terminalId,
  shellId,
  className,
}: ResourceInfoProps) {
  const { resourceInfo } = useProcessContext()
  const { terminals } = useTerminalContext()
  const [mode, setMode] = useLocalStorage<'bar' | 'percent'>(
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('cursor-pointer', className)}>
          <ResourceView
            cpuPercent={aggregated.cpuPercent}
            memPercent={aggregated.memPercent}
            mode={mode}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-fit max-w-[95vw] max-h-[90vh] pt-[env(safe-area-inset-top)] p-3"
        align="center"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground">
            Resource Usage
          </span>
          <div className="flex items-center gap-1.5">
            <Percent className="w-3 h-3 text-muted-foreground" />
            <Switch
              checked={mode === 'percent'}
              onCheckedChange={(checked) =>
                setMode(checked ? 'percent' : 'bar')
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          {shellId !== undefined ? (
            <ShellRow
              shellId={shellId}
              label={
                terminals.flatMap((t) => t.shells).find((s) => s.id === shellId)
                  ?.name ?? `shell-${shellId}`
              }
              usage={usage}
              totalRam={totalRam}
              totalCpu={totalCpu}
              mode={mode}
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
                      mode={mode}
                      className="scale-90 origin-right"
                    />
                  </div>
                  {terminal.shells.map((shell) => (
                    <ShellRow
                      key={shell.id}
                      shellId={shell.id}
                      label={shell.name}
                      usage={usage}
                      totalRam={totalRam}
                      totalCpu={totalCpu}
                      mode={mode}
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
  label,
  usage,
  totalRam,
  totalCpu,
  mode,
}: {
  shellId: number
  label: string
  usage: Record<number, { rss: number; cpu: number }>
  totalRam: number
  totalCpu: number
  mode: 'bar' | 'percent'
}) {
  const connected = shellId in usage
  const shellUsage = computeUsage(usage, [shellId], totalRam, totalCpu)
  return (
    <div className="flex items-center justify-between py-0.5 pl-3">
      <span
        className={cn(
          'text-xs truncate max-w-[180px]',
          connected ? 'text-muted-foreground' : 'text-muted-foreground/40',
        )}
      >
        {label}
      </span>
      {connected ? (
        <ResourceView
          cpuPercent={shellUsage.cpuPercent}
          memPercent={shellUsage.memPercent}
          mode={mode}
          className="scale-90 origin-right"
        />
      ) : (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
          <Unplug className="w-3 h-3" />
        </span>
      )}
    </div>
  )
}
