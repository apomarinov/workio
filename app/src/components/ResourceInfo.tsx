import {
  BarChart3,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Globe,
  Hash,
  Percent,
  Unplug,
} from 'lucide-react'
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
import type { ActiveProcess, HostResourceInfo } from '../../shared/types'
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
  const [expandedTerminals, setExpandedTerminals] = useState<Set<number>>(
    new Set(),
  )

  const { totalRam, totalCpu, usage, systemCpu, systemRss, hostResources } =
    resourceInfo
  const noScope = terminalId === undefined && shellId === undefined

  // No data available (e.g. process tree command errored out)
  if (totalRam === 0 || totalCpu === 0 || Object.keys(usage).length === 0) {
    return null
  }

  // System-wide metrics
  const systemMemPercent =
    totalRam > 0 ? ((systemRss * 1024) / totalRam) * 100 : 0
  const systemCpuPercent = totalCpu > 0 ? systemCpu / totalCpu : 0

  // Resolve correct totalRam/totalCpu for a terminal (SSH-aware)
  const getTerminalTotals = (
    sshHost: string | null,
  ): { ram: number; cpu: number } => {
    if (sshHost && hostResources[sshHost]) {
      return {
        ram: hostResources[sshHost].systemMemory,
        cpu: hostResources[sshHost].cpuCount,
      }
    }
    return { ram: totalRam, cpu: totalCpu }
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

  // For the trigger badge: use SSH host totals if scoped to an SSH terminal
  const scopedTerminal =
    terminalId !== undefined
      ? terminals.find((t) => t.id === terminalId)
      : undefined
  const scopeTotals = scopedTerminal
    ? getTerminalTotals(scopedTerminal.ssh_host)
    : { ram: totalRam, cpu: totalCpu }
  const aggregated = computeUsage(
    usage,
    scopeShellIds,
    scopeTotals.ram,
    scopeTotals.cpu,
  )

  // Build grouped data for popover
  const scopeTerminals =
    terminalId !== undefined
      ? terminals.filter((t) => t.id === terminalId)
      : terminals

  // Group scopeTerminals into local vs SSH host groups
  const localTerminals = scopeTerminals.filter((t) => !t.ssh_host)
  const sshHostGroups = new Map<
    string,
    { terminals: typeof scopeTerminals; info: HostResourceInfo | undefined }
  >()
  for (const t of scopeTerminals) {
    if (t.ssh_host) {
      const existing = sshHostGroups.get(t.ssh_host)
      if (existing) {
        existing.terminals.push(t)
      } else {
        sshHostGroups.set(t.ssh_host, {
          terminals: [t],
          info: hostResources[t.ssh_host],
        })
      }
    }
  }

  // Index processes by shellId
  const processesByShell = new Map<number, ActiveProcess[]>()
  for (const p of processes) {
    if (p.shellId !== undefined) {
      const arr = processesByShell.get(p.shellId)
      if (arr) arr.push(p)
      else processesByShell.set(p.shellId, [p])
    }
  }

  const toggleTerminal = (id: number) => {
    setExpandedTerminals((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allExpanded =
    scopeTerminals.length > 0 &&
    scopeTerminals.every((t) => expandedTerminals.has(t.id))

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedTerminals(new Set())
    } else {
      setExpandedTerminals(new Set(scopeTerminals.map((t) => t.id)))
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('cursor-pointer', className)}>
          <ResourceView
            cpuPercent={noScope ? systemCpuPercent : aggregated.cpuPercent}
            memPercent={noScope ? systemMemPercent : aggregated.memPercent}
            memRssKb={noScope ? systemRss : aggregated.rssKb}
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
          <div className="flex items-center gap-1">
            {noScope && scopeTerminals.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="h-6 px-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {allExpanded ? (
                  <ChevronsDownUp className="w-3 h-3" />
                ) : (
                  <ChevronsUpDown className="w-3 h-3" />
                )}
              </button>
            )}
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
        </div>

        <div className="space-y-2">
          {noScope && (
            <>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs font-medium truncate max-w-[180px]">
                  System
                </span>
                <ResourceView
                  cpuPercent={systemCpuPercent}
                  memPercent={systemMemPercent}
                  memRssKb={systemRss}
                  mode={mode}
                  className="scale-90 origin-right"
                />
              </div>
              <div className="border-t border-zinc-700/50" />
            </>
          )}
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
              totalRam={scopeTotals.ram}
              totalCpu={scopeTotals.cpu}
              mode={mode}
              processes={processesByShell.get(shellId) ?? []}
            />
          ) : noScope ? (
            <>
              {localTerminals.map((terminal) => (
                <TerminalRow
                  key={terminal.id}
                  terminal={terminal}
                  usage={usage}
                  totalRam={totalRam}
                  totalCpu={totalCpu}
                  mode={mode}
                  expandedTerminals={expandedTerminals}
                  toggleTerminal={toggleTerminal}
                  processesByShell={processesByShell}
                  collapsible
                />
              ))}
              {[...sshHostGroups].map(([host, group]) => {
                const info = group.info
                const hostRam = info?.systemMemory ?? totalRam
                const hostCpuCount = info?.cpuCount ?? totalCpu
                return (
                  <div key={host}>
                    <div className="border-t border-zinc-700/50 my-1" />
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-medium truncate max-w-[180px] flex items-center gap-1">
                        <Globe className="w-3 h-3 flex-shrink-0" />
                        {host}
                      </span>
                      {info && (
                        <ResourceView
                          cpuPercent={
                            info.cpuCount > 0
                              ? info.systemCpu / info.cpuCount
                              : 0
                          }
                          memPercent={
                            info.systemMemory > 0
                              ? ((info.systemRss * 1024) / info.systemMemory) *
                                100
                              : 0
                          }
                          memRssKb={info.systemRss}
                          mode={mode}
                          className="scale-90 origin-right"
                        />
                      )}
                    </div>
                    {group.terminals.map((terminal) => (
                      <TerminalRow
                        key={terminal.id}
                        terminal={terminal}
                        usage={usage}
                        totalRam={hostRam}
                        totalCpu={hostCpuCount}
                        mode={mode}
                        expandedTerminals={expandedTerminals}
                        toggleTerminal={toggleTerminal}
                        processesByShell={processesByShell}
                        collapsible
                      />
                    ))}
                  </div>
                )
              })}
            </>
          ) : (
            <>
              {scopedTerminal?.ssh_host &&
                hostResources[scopedTerminal.ssh_host] && (
                  <>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-medium truncate max-w-[180px] flex items-center gap-1">
                        <Globe className="w-3 h-3 flex-shrink-0" />
                        {scopedTerminal.ssh_host}
                      </span>
                      <ResourceView
                        cpuPercent={
                          hostResources[scopedTerminal.ssh_host].cpuCount > 0
                            ? hostResources[scopedTerminal.ssh_host].systemCpu /
                              hostResources[scopedTerminal.ssh_host].cpuCount
                            : 0
                        }
                        memPercent={
                          hostResources[scopedTerminal.ssh_host].systemMemory >
                          0
                            ? ((hostResources[scopedTerminal.ssh_host]
                                .systemRss *
                                1024) /
                                hostResources[scopedTerminal.ssh_host]
                                  .systemMemory) *
                              100
                            : 0
                        }
                        memRssKb={
                          hostResources[scopedTerminal.ssh_host].systemRss
                        }
                        mode={mode}
                        className="scale-90 origin-right"
                      />
                    </div>
                    <div className="border-t border-zinc-700/50" />
                  </>
                )}
              {scopeTerminals.map((terminal) => {
                const totals = getTerminalTotals(terminal.ssh_host)
                return (
                  <TerminalRow
                    key={terminal.id}
                    terminal={terminal}
                    usage={usage}
                    totalRam={totals.ram}
                    totalCpu={totals.cpu}
                    mode={mode}
                    expandedTerminals={expandedTerminals}
                    toggleTerminal={toggleTerminal}
                    processesByShell={processesByShell}
                    collapsible={false}
                  />
                )
              })}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TerminalRow({
  terminal,
  usage,
  totalRam,
  totalCpu,
  mode,
  expandedTerminals,
  toggleTerminal,
  processesByShell,
  collapsible,
}: {
  terminal: {
    id: number
    name: string | null
    shells: { id: number; name: string }[]
  }
  usage: Record<number, { rss: number; cpu: number }>
  totalRam: number
  totalCpu: number
  mode: ResourceViewMode
  expandedTerminals: Set<number>
  toggleTerminal: (id: number) => void
  processesByShell: Map<number, ActiveProcess[]>
  collapsible: boolean
}) {
  const termShellIds = terminal.shells.map((s) => s.id)
  const termUsage = computeUsage(usage, termShellIds, totalRam, totalCpu)
  const isExpanded = !collapsible || expandedTerminals.has(terminal.id)

  return (
    <div>
      <div
        className={cn(
          'flex items-center justify-between py-1',
          collapsible && 'cursor-pointer',
        )}
        onClick={collapsible ? () => toggleTerminal(terminal.id) : undefined}
      >
        <span
          className={cn(
            'text-xs font-medium text-muted-foreground hover:text-foreground truncate max-w-[180px] flex items-center gap-1',
            isExpanded && 'text-foreground',
          )}
        >
          {collapsible && (
            <ChevronDown
              className={cn(
                'w-3 h-3 transition-transform flex-shrink-0',
                !isExpanded && '-rotate-90',
              )}
            />
          )}
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
      {isExpanded &&
        terminal.shells.map((shell) => (
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
