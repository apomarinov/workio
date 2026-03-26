import os from 'node:os'
import { disposeGitState } from '@domains/git/services/status'
import type {
  ActiveProcess,
  CommandEvent,
  HostResourceInfo,
  PortForwardStatus,
  RemoteProcessInfo,
  ResourceUsage,
} from '@domains/pty/schema'
import {
  findRemoteZellijServerPid,
  getActiveZellijSessionNames,
  getChildPids,
  getDescendantPids,
  getListeningPortsForTerminal,
  getProcessComm,
  getRemoteDescendantPids,
  getRemoteHostInfo,
  getRemoteListeningPorts,
  getRemoteListeningPortsForTerminal,
  getRemoteProcessList,
  getRemoteZellijSessionProcesses,
  getSystemListeningPorts,
  getSystemMemoryUsage,
  getSystemResourceUsage,
  getZellijSessionProcesses,
} from '@domains/pty/services/process-tree'
import {
  getAllSessions,
  getSession,
  getSessionsForTerminal,
  handleBellNotification,
  type PtySession,
} from '@domains/pty/session'
import { updateShell } from '@domains/workspace/db/shells'
import {
  getAllTerminals,
  getTerminalById,
} from '@domains/workspace/db/terminals'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { sanitizeName } from '@server/lib/strings'
import { log } from '@server/logger'
import { closeConnection } from '@server/ssh/pool'
import {
  getTunnelStatuses,
  reconcileTunnels,
  stopAllTunnelsForTerminal,
} from '@server/ssh/tunnel'

// ── Constants ────────────────────────────────────────────────────────

const SYSTEM_MEMORY = os.totalmem()
const CPU_COUNT = os.cpus().length
const COMMAND_IGNORE_LIST: string[] = []
const IGNORE_SHELL_COMMANDS = ['clear']

// ── Global shared state ──────────────────────────────────────────────

const sshHostInfoCache = new Map<
  string,
  { cpuCount: number; systemMemory: number }
>()

const processFirstSeen = new Map<string, number>()

let globalProcessPollingId: NodeJS.Timeout | null = null

// ── TerminalMonitor class ────────────────────────────────────────────

const monitors = new Map<number, TerminalMonitor>()

export class TerminalMonitor {
  readonly terminalId: number
  processPollTimeout: NodeJS.Timeout | null = null

  constructor(terminalId: number) {
    this.terminalId = terminalId
  }

  clearProcessPollTimeout() {
    if (this.processPollTimeout) {
      clearTimeout(this.processPollTimeout)
      this.processPollTimeout = null
    }
  }

  dispose() {
    this.clearProcessPollTimeout()
  }
}

// ── Monitor lookup helpers ───────────────────────────────────────────

export function getMonitor(terminalId: number) {
  return monitors.get(terminalId)
}

export function getOrCreateMonitor(terminalId: number) {
  let monitor = monitors.get(terminalId)
  if (!monitor) {
    monitor = new TerminalMonitor(terminalId)
    monitors.set(terminalId, monitor)
  }
  return monitor
}

function disposeMonitor(terminalId: number) {
  const monitor = monitors.get(terminalId)
  if (monitor) {
    monitor.dispose()
    monitors.delete(terminalId)
  }
}

// ── Shell update helper ──────────────────────────────────────────────

type ShellUpdates = { active_cmd?: string | null }

function emitShellUpdate(
  terminalId: number,
  shellId: number,
  updates: ShellUpdates,
) {
  if (
    updates.active_cmd === '' ||
    (updates.active_cmd &&
      IGNORE_SHELL_COMMANDS.includes(updates.active_cmd.trim()))
  )
    return
  log.info(
    `[pty] shell:updated t=${terminalId} s=${shellId} active_cmd=${updates.active_cmd === undefined ? '(unchanged)' : updates.active_cmd === null ? 'null' : `"${updates.active_cmd}"`}`,
  )
  updateShell(shellId, updates)
  getIO()?.emit('shell:updated', { terminalId, shellId, data: updates })
}

// ── Process start time tracking ──────────────────────────────────────

function stampProcessStartTimes(processes: ActiveProcess[]) {
  const currentKeys = new Set<string>()
  const now = Date.now()
  for (const proc of processes) {
    const key = `${proc.terminalId}:${proc.shellId}:${proc.command}`
    currentKeys.add(key)
    if (!processFirstSeen.has(key)) {
      processFirstSeen.set(key, now)
    }
    proc.startedAt = processFirstSeen.get(key)
  }
  for (const key of processFirstSeen.keys()) {
    if (!currentKeys.has(key)) {
      processFirstSeen.delete(key)
    }
  }
}

// ── Process scanning ─────────────────────────────────────────────────

interface ProcessScanSession {
  currentCommand: string | null
  pty: { pid: number }
  sessionName: string
  shell: { id: number; name: string }
  remotePid: number
}

async function getProcessesForTerminal(
  terminalId: number,
  session: ProcessScanSession,
  remoteProcs?: RemoteProcessInfo[],
) {
  const processes: ActiveProcess[] = []

  try {
    if (
      session.currentCommand &&
      !COMMAND_IGNORE_LIST.includes(session.currentCommand)
    ) {
      let directPid = 0
      const shellPid = session.pty.pid
      if (shellPid > 0) {
        try {
          const childPids = await getChildPids(shellPid)
          const cmdName = session.currentCommand.split(' ')[0] || ''
          const comms = await Promise.all(
            childPids.map(async (cpid) => ({
              cpid,
              comm: await getProcessComm(cpid),
            })),
          )
          for (const { cpid, comm } of comms) {
            if (comm) {
              const basename = comm.split('/').pop() || comm
              if (basename === cmdName || comm === cmdName) {
                directPid = cpid
                break
              }
            }
          }
        } catch {
          // Fall back to pid 0
        }
      } else if (session.remotePid > 0 && remoteProcs) {
        const descendants = getRemoteDescendantPids(
          remoteProcs,
          session.remotePid,
        )
        const cmdName = session.currentCommand.split(' ')[0] || ''
        for (const desc of descendants) {
          const proc = remoteProcs.find((p) => p.pid === desc)
          if (proc) {
            const basename = proc.comm.split('/').pop() || proc.comm
            if (basename === cmdName || proc.comm === cmdName) {
              directPid = proc.pid
              break
            }
          }
        }
      }
      processes.push({
        pid: directPid,
        name: session.currentCommand.split(' ')[0] || '',
        command: session.currentCommand,
        terminalId,
        shellId: session.shell.id,
        source: 'direct',
      })
    }

    if (session.pty.pid > 0) {
      let zellijProcs = await getZellijSessionProcesses(
        session.sessionName,
        terminalId,
      )
      if (zellijProcs.length === 0) {
        const terminal = await getTerminalById(terminalId)
        const currentName = terminal?.name || `terminal-${terminalId}`
        const expectedName =
          session.shell.name === 'main'
            ? currentName
            : `${currentName}-${session.shell.name}`
        if (expectedName !== session.sessionName) {
          zellijProcs = await getZellijSessionProcesses(
            expectedName,
            terminalId,
          )
        }
      }
      for (const p of zellijProcs.filter((p) => !p.isIdle)) {
        processes.push({
          pid: p.pid,
          name: p.command.split(' ')[0] || '',
          command: p.command,
          terminalId: p.terminalId,
          shellId: session.shell.id,
          source: 'zellij',
        })
      }
    } else if (session.remotePid > 0 && remoteProcs) {
      const zellijProcs = getRemoteZellijSessionProcesses(
        remoteProcs,
        session.remotePid,
        terminalId,
      )
      for (const p of zellijProcs.filter((p) => !p.isIdle)) {
        processes.push({
          pid: p.pid,
          name: p.command.split(' ')[0] || '',
          command: p.command,
          terminalId: p.terminalId,
          shellId: session.shell.id,
          source: 'zellij',
        })
      }
    }
  } catch (err) {
    log.error({ err }, '[pty] Failed to get processes for terminal')
  }

  return processes
}

async function getPortsForTerminal(
  session: ProcessScanSession,
  systemPorts: Map<number, number[]>,
  remoteProcs?: RemoteProcessInfo[],
  remotePorts?: Map<number, number[]>,
) {
  if (session.pty.pid > 0) {
    return await getListeningPortsForTerminal(
      session.pty.pid,
      session.sessionName,
      systemPorts,
    )
  }
  if (session.remotePid > 0 && remotePorts && remoteProcs) {
    const zellijServerPid = findRemoteZellijServerPid(
      remoteProcs,
      session.remotePid,
    )
    return getRemoteListeningPortsForTerminal(
      remoteProcs,
      session.remotePid,
      remotePorts,
      zellijServerPid,
    )
  }
  return []
}

async function scanSessions(sessionList: PtySession[]) {
  const allProcesses: ActiveProcess[] = []

  // Batch remote ps per SSH host (before per-session loop)
  const remoteHosts = new Set<string>()
  for (const s of sessionList) {
    if (s.sshHost && s.remotePid > 0) {
      remoteHosts.add(s.sshHost)
    }
  }
  const remoteProcesses = new Map<string, RemoteProcessInfo[]>()
  const remotePortsMap = new Map<string, Map<number, number[]>>()
  const remotePromises = [...remoteHosts].map(async (host) => {
    const fetches: Promise<unknown>[] = [
      getRemoteProcessList(host).then((procs) =>
        remoteProcesses.set(host, procs),
      ),
      getRemoteListeningPorts(host).then((ports) =>
        remotePortsMap.set(host, ports),
      ),
    ]
    // Fetch static host info (CPU count + RAM) once, then cache
    if (!sshHostInfoCache.has(host)) {
      fetches.push(
        getRemoteHostInfo(host).then((info) => {
          if (info) sshHostInfoCache.set(host, info)
        }),
      )
    }
    await Promise.all(fetches)
  })

  const [systemPorts, systemResources, systemMemory] = await Promise.all([
    getSystemListeningPorts(),
    getSystemResourceUsage(),
    getSystemMemoryUsage(),
    ...remotePromises,
  ])
  const ports: Record<number, number[]> = {}
  const shellPorts: Record<number, number[]> = {}
  const resourceUsage: Record<number, ResourceUsage> = {}

  await Promise.all(
    sessionList.map(async (s) => {
      const session: ProcessScanSession = {
        currentCommand: s.currentCommand,
        pty: { pid: s.ptyPid },
        sessionName: s.sessionName,
        shell: s.shell,
        remotePid: s.remotePid,
      }
      const hostProcs = s.sshHost ? remoteProcesses.get(s.sshHost) : undefined
      const hostPorts = s.sshHost ? remotePortsMap.get(s.sshHost) : undefined
      const [procs, shellPortList] = await Promise.all([
        getProcessesForTerminal(s.terminalId, session, hostProcs),
        getPortsForTerminal(session, systemPorts, hostProcs, hostPorts),
      ])
      allProcesses.push(...procs)

      if (shellPortList.length > 0) {
        const existing = ports[s.terminalId] || []
        ports[s.terminalId] = [
          ...new Set([...existing, ...shellPortList]),
        ].sort((a, b) => a - b)
        shellPorts[s.shell.id] = [...new Set(shellPortList)].sort(
          (a, b) => a - b,
        )
      }

      // Compute resource usage for this shell
      if (s.ptyPid > 0) {
        const descendants = await getDescendantPids(s.ptyPid)
        descendants.add(s.ptyPid)
        let rss = 0
        let cpu = 0
        let pidCount = 0
        for (const pid of descendants) {
          const usage = systemResources.get(pid)
          if (usage) {
            rss += usage.rss
            cpu += usage.cpu
            pidCount++
          }
        }
        resourceUsage[s.shell.id] = {
          rss,
          cpu: Math.round(cpu * 10) / 10,
          pidCount,
        }
      } else if (s.sshHost && s.remotePid > 0 && hostProcs) {
        const descendants = getRemoteDescendantPids(hostProcs, s.remotePid)
        descendants.add(s.remotePid)
        let rss = 0
        let cpu = 0
        let pidCount = 0
        for (const desc of descendants) {
          const proc = hostProcs.find((p) => p.pid === desc)
          if (proc) {
            rss += proc.rss
            cpu += proc.cpu
            pidCount++
          }
        }
        resourceUsage[s.shell.id] = {
          rss,
          cpu: Math.round(cpu * 10) / 10,
          pidCount,
        }
      }

      // Clear stale active_cmd if no actual process found after multiple scans
      if (s.currentCommand) {
        if (procs.some((p) => p.source === 'direct' && p.pid > 0)) {
          s.staleScanCount = 0
        } else {
          s.staleScanCount++
          log.info(
            `[pty] t=${s.terminalId} s=${s.shell.id} stale scan ${s.staleScanCount}/3 for "${s.currentCommand}"`,
          )
          if (s.staleScanCount >= 3) {
            let shellAlive = false
            if (s.ptyPid > 0) {
              shellAlive = (await getProcessComm(s.ptyPid)) !== null
            } else if (s.sshHost && s.remotePid > 0) {
              shellAlive =
                hostProcs?.some((p) => p.pid === s.remotePid) ?? false
            }
            if (shellAlive) {
              s.staleScanCount = 0
            } else {
              log.info(
                `[pty] t=${s.terminalId} s=${s.shell.id} clearing stale active_cmd "${s.currentCommand}"`,
              )
              s.currentCommand = null
              s.staleScanCount = 0
              emitShellUpdate(s.terminalId, s.shell.id, { active_cmd: null })
            }
          }
        }
      }
    }),
  )

  stampProcessStartTimes(allProcesses)

  // Compute total system CPU from all local processes
  let systemCpu = 0
  for (const { cpu } of systemResources.values()) {
    systemCpu += cpu
  }
  systemCpu = Math.round(systemCpu * 10) / 10
  const systemRss = systemMemory?.usedKb ?? 0

  // Compute per-SSH-host system totals
  const hostResources: Record<string, HostResourceInfo> = {}
  for (const host of remoteHosts) {
    const cached = sshHostInfoCache.get(host)
    const procs = remoteProcesses.get(host)
    if (cached && procs) {
      let hostCpu = 0
      let hostRss = 0
      for (const p of procs) {
        hostCpu += p.cpu
        hostRss += p.rss
      }
      hostResources[host] = {
        systemMemory: cached.systemMemory,
        cpuCount: cached.cpuCount,
        systemCpu: Math.round(hostCpu * 10) / 10,
        systemRss: hostRss,
      }
    }
  }

  return {
    processes: allProcesses,
    ports,
    shellPorts,
    resourceUsage,
    systemCpu,
    systemRss,
    remoteProcesses,
    hostResources,
  }
}

// ── Tunnel reconciliation ────────────────────────────────────────────

async function reconcileTunnelsForTerminals(
  terminalIds: number[],
  ports: Record<number, number[]>,
) {
  const portForwardStatus: Record<number, PortForwardStatus[]> = {}
  const allSessions = getAllSessions()
  const sshTerminalIds = new Set<number>()
  for (const s of allSessions.values()) {
    if (s.sshHost && terminalIds.includes(s.terminalId)) {
      sshTerminalIds.add(s.terminalId)
    }
  }
  for (const terminalId of sshTerminalIds) {
    try {
      const terminal = await getTerminalById(terminalId)
      if (!terminal?.settings?.portMappings?.length) continue
      const detectedPorts = ports[terminalId] ?? []
      const sshHost = terminal.ssh_host
      if (!sshHost) continue
      reconcileTunnels(
        terminalId,
        sshHost,
        detectedPorts,
        terminal.settings.portMappings,
      )
      const statuses = getTunnelStatuses(terminalId)
      if (statuses.length > 0) portForwardStatus[terminalId] = statuses
    } catch (err) {
      log.error(
        { err },
        `[pty] Failed to reconcile tunnels for terminal ${terminalId}`,
      )
    }
  }
  return portForwardStatus
}

// ── Process scanning (exported) ──────────────────────────────────────

export async function scanAndEmitProcessesForTerminal(terminalId: number) {
  const sessionList = getSessionsForTerminal(terminalId)
  if (sessionList.length === 0) return

  const result = await scanSessions(sessionList)
  const { remoteProcesses: _, ...payload } = result

  const portForwardStatus = await reconcileTunnelsForTerminals(
    [terminalId],
    result.ports,
  )

  getIO()?.emit('processes', {
    terminalId,
    ...payload,
    ...(Object.keys(portForwardStatus).length > 0 && { portForwardStatus }),
    systemMemory: SYSTEM_MEMORY,
    cpuCount: CPU_COUNT,
  })
}

async function scanAndEmitAllProcesses() {
  const allSessions = getAllSessions()
  const sessionList = [...allSessions.values()]
  const result = await scanSessions(sessionList)

  // Check for active zellij sessions (local)
  try {
    const zellijSessions = await getActiveZellijSessionNames()
    if (zellijSessions.size > 0) {
      const sessionTerminalIds = new Set<number>()
      for (const s of allSessions.values()) {
        sessionTerminalIds.add(s.terminalId)
        if (
          zellijSessions.has(s.sessionName) ||
          zellijSessions.has(sanitizeName(s.sessionName))
        ) {
          result.processes.push({
            pid: 0,
            name: 'zellij',
            command: 'zellij',
            terminalId: s.terminalId,
            shellId: s.shell.id,
            source: 'zellij',
            isZellij: true,
          })
        }
      }
      const terminals = await getAllTerminals()
      for (const terminal of terminals) {
        if (sessionTerminalIds.has(terminal.id)) continue
        const terminalName = terminal.name || `terminal-${terminal.id}`
        if (
          zellijSessions.has(terminalName) ||
          zellijSessions.has(sanitizeName(terminalName))
        ) {
          result.processes.push({
            pid: 0,
            name: 'zellij',
            command: 'zellij',
            terminalId: terminal.id,
            source: 'zellij',
            isZellij: true,
          })
        }
      }
    }
  } catch (err) {
    log.error({ err }, '[pty] Failed to detect zellij sessions')
  }

  // Check for active zellij sessions (remote SSH)
  for (const s of allSessions.values()) {
    if (s.sshHost && s.remotePid > 0) {
      const hostProcs = result.remoteProcesses.get(s.sshHost)
      if (hostProcs) {
        const serverPid = findRemoteZellijServerPid(hostProcs, s.remotePid)
        if (serverPid) {
          result.processes.push({
            pid: 0,
            name: 'zellij',
            command: 'zellij',
            terminalId: s.terminalId,
            shellId: s.shell.id,
            source: 'zellij',
            isZellij: true,
          })
        }
      }
    }
  }

  // Reconcile SSH tunnels for all terminals
  const allTerminalIds = [
    ...new Set([...allSessions.values()].map((s) => s.terminalId)),
  ]
  const portForwardStatus = await reconcileTunnelsForTerminals(
    allTerminalIds,
    result.ports,
  )

  const { remoteProcesses: _remote, ...globalPayload } = result
  getIO()?.emit('processes', {
    ...globalPayload,
    ...(Object.keys(portForwardStatus).length > 0 && { portForwardStatus }),
    systemMemory: SYSTEM_MEMORY,
    cpuCount: CPU_COUNT,
  })
}

// ── Global polling ───────────────────────────────────────────────────

function startGlobalProcessPolling() {
  if (globalProcessPollingId) return
  globalProcessPollingId = setInterval(scanAndEmitAllProcesses, 3000)
}

function stopGlobalProcessPolling() {
  if (globalProcessPollingId && getAllSessions().size === 0) {
    clearInterval(globalProcessPollingId)
    globalProcessPollingId = null
  }
}

// ── Worker command event handler ─────────────────────────────────────

function handleWorkerCommandEvent(
  terminalId: number,
  shellId: number,
  event: CommandEvent,
  session: PtySession,
) {
  const monitor = getOrCreateMonitor(terminalId)

  switch (event.type) {
    case 'command_start':
      log.info(
        `[pty] t=${terminalId} s=${shellId} Command start: "${event.command}"`,
      )
      session.staleScanCount = 0
      emitShellUpdate(terminalId, shellId, {
        active_cmd: event.command || null,
      })
      // Debounced process poll
      {
        monitor.clearProcessPollTimeout()
        monitor.processPollTimeout = setTimeout(() => {
          monitor.processPollTimeout = null
          scanAndEmitProcessesForTerminal(terminalId)
        }, 1000)
      }
      break

    case 'command_end': {
      log.info(
        `[pty] t=${terminalId} s=${shellId} Command end: "${session.currentCommand}"`,
      )
      emitShellUpdate(terminalId, shellId, { active_cmd: null })
      monitor.clearProcessPollTimeout()

      serverEvents.emit('pty:command-end', { terminalId })
      setTimeout(() => {
        scanAndEmitProcessesForTerminal(terminalId)
      }, 1000)

      // Bell notification (delegated to session domain)
      handleBellNotification(session, event)
      break
    }

    case 'remote_pid':
      if (event.remotePid && event.remotePid > 0) {
        session.remotePid = event.remotePid
        log.info(
          `[pty] t=${terminalId} s=${shellId} Remote PID: ${event.remotePid}`,
        )
      }
      break

    case 'done_marker':
      // done_marker is handled by the session's onDoneMarker callback
      break
  }
}

// ── Server event listeners ────────────────────────────────────────────

serverEvents.on('pty:command-event', ({ terminalId, shellId, event }) => {
  const session = getSession(shellId)
  if (!session) {
    log.error(`[pty] command-event for unknown shell ${shellId}`)
    return
  }
  handleWorkerCommandEvent(terminalId, shellId, event, session)
})

serverEvents.on('pty:session-created', ({ terminalId }) => {
  getOrCreateMonitor(terminalId)
})

serverEvents.on('pty:session-destroyed', () => {
  stopGlobalProcessPolling()
})

serverEvents.on(
  'pty:terminal-sessions-destroyed',
  ({ terminalId, sshHost }) => {
    disposeMonitor(terminalId)
    disposeGitState(terminalId)
    stopGlobalProcessPolling()
    stopAllTunnelsForTerminal(terminalId)

    // Close SSH pool connection and clear cache if no other terminals use the same host
    if (sshHost) {
      const allSessions = getAllSessions()
      const otherUsesHost = [...allSessions.values()].some(
        (s) => s.sshHost === sshHost,
      )
      if (!otherUsesHost) {
        closeConnection(sshHost)
        sshHostInfoCache.delete(sshHost)
      }
    }
  },
)

// Start process polling when module loads (sessions may exist)
startGlobalProcessPolling()
