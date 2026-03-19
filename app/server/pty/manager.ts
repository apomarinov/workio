import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNotification } from '@domains/notifications/registry'
import { sendPushNotification } from '@domains/notifications/service'
import { updateShell } from '@domains/workspace/db/shells'
import {
  getAllTerminals,
  getTerminalById,
  updateTerminal,
} from '@domains/workspace/db/terminals'
import type {
  ActiveProcess,
  GitLastCommit,
  HostResourceInfo,
  PortForwardStatus,
  ResourceUsage,
} from '../../shared/types'
import {
  getGhUsername,
  refreshPRChecks,
  untrackTerminal,
} from '../github/checks'
import { getIO } from '../io'
import { sanitizeName, shellEscape } from '../lib/strings'
import { log } from '../logger'
import { execSSHCommand } from '../ssh/exec'
import { closeConnection } from '../ssh/pool'
import {
  getTunnelStatuses,
  reconcileTunnels,
  stopAllTunnelsForTerminal,
} from '../ssh/tunnel'
import { emitWorkspace } from '../workspace/emit'
import type { CommandEvent } from './osc-parser'
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
  type RemoteProcessInfo,
} from './process-tree'
import {
  getAllWorkers,
  getWorkersForTerminal,
  destroySession as proxyDestroySession,
  destroySessionsForTerminal as proxyDestroySessionsForTerminal,
  setCommandEventHandler,
  type WorkerHandle,
} from './session-proxy'

// ── Re-export session proxy functions ───────────────────────────────

export {
  attachSession,
  cancelWaitForMarker,
  clearSessionTimeout,
  createSession,
  destroyAllSessions,
  getSession,
  getSessionBuffer,
  getSessionByTerminalId,
  hasActiveSession,
  hasActiveSessionForTerminal,
  interruptSession,
  killShellChildren,
  resizeSession,
  startSessionTimeout,
  updateSessionName,
  waitForMarker,
  waitForSession,
  writeToSession,
} from './session-proxy'

// setPendingCommand needs local tracking for shells that don't have
// a worker yet (newly created shell, PTY not spawned).
// The proxy sends via IPC if the worker exists; otherwise we store here
// and the worker's prompt handler will pick it up after init.
import {
  hasActiveSession as proxyHasActiveSession,
  setPendingCommand as proxySetPendingCommand,
} from './session-proxy'

const pendingCommands = new Map<number, string>()

export function setPendingCommand(shellId: number, command: string) {
  if (proxyHasActiveSession(shellId)) {
    proxySetPendingCommand(shellId, command)
  } else {
    pendingCommands.set(shellId, command)
  }
}

/**
 * Called by session-proxy after worker is ready to flush any
 * locally-queued pending command.
 */
export function flushPendingCommand(shellId: number): string | undefined {
  const cmd = pendingCommands.get(shellId)
  if (cmd) {
    pendingCommands.delete(shellId)
  }
  return cmd
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SYSTEM_MEMORY = os.totalmem()
const CPU_COUNT = os.cpus().length

const COMMAND_IGNORE_LIST: string[] = []

// Cache static SSH host info (RAM/CPU count) — fetched once per host
const sshHostInfoCache = new Map<
  string,
  { cpuCount: number; systemMemory: number }
>()

// ── Process start time tracking ─────────────────────────────────────

const processFirstSeen = new Map<string, number>()

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

// ── Bell subscriptions ──────────────────────────────────────────────

interface BellSubscription {
  shellId: number
  terminalId: number
  command: string
  terminalName: string
}
const bellSubscriptions = new Map<number, BellSubscription>()

export function subscribeBell(sub: BellSubscription): void {
  bellSubscriptions.set(sub.shellId, sub)
  getIO()?.emit('bell:subscriptions', getBellSubscribedShellIds())
}

export function unsubscribeBell(shellId: number): void {
  bellSubscriptions.delete(shellId)
  getIO()?.emit('bell:subscriptions', getBellSubscribedShellIds())
}

export function getBellSubscribedShellIds(): number[] {
  return [...bellSubscriptions.keys()]
}

// ── Shell update helper ─────────────────────────────────────────────

type ShellUpdates = { active_cmd?: string | null }

const IGNORE_SHELL_COMMANDS = ['clear']

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

// ── Global process polling ──────────────────────────────────────────

let globalProcessPollingId: NodeJS.Timeout | null = null

// Process polling timer per-terminal (debounced after command events)
const processPollTimeoutIds = new Map<number, NodeJS.Timeout>()

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
): Promise<ActiveProcess[]> {
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
        // SSH terminal: find direct process via remote process tree
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
      // Local zellij scanning
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
      // Remote zellij scanning via already-fetched process data
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
): Promise<number[]> {
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

async function scanWorkers(handles: WorkerHandle[]) {
  const allProcesses: ActiveProcess[] = []

  // Batch remote ps per SSH host (before per-handle loop)
  const remoteHosts = new Set<string>()
  for (const h of handles) {
    if (h.sshHost && h.remotePid > 0) {
      remoteHosts.add(h.sshHost)
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
    handles.map(async (h) => {
      const session: ProcessScanSession = {
        currentCommand: h.currentCommand,
        pty: { pid: h.ptyPid },
        sessionName: h.sessionName,
        shell: h.shell,
        remotePid: h.remotePid,
      }
      const hostProcs = h.sshHost ? remoteProcesses.get(h.sshHost) : undefined
      const hostPorts = h.sshHost ? remotePortsMap.get(h.sshHost) : undefined
      const [procs, shellPortList] = await Promise.all([
        getProcessesForTerminal(h.terminalId, session, hostProcs),
        getPortsForTerminal(session, systemPorts, hostProcs, hostPorts),
      ])
      allProcesses.push(...procs)

      if (shellPortList.length > 0) {
        const existing = ports[h.terminalId] || []
        ports[h.terminalId] = [
          ...new Set([...existing, ...shellPortList]),
        ].sort((a, b) => a - b)
        shellPorts[h.shell.id] = [...new Set(shellPortList)].sort(
          (a, b) => a - b,
        )
      }

      // Compute resource usage for this shell
      if (h.ptyPid > 0) {
        const descendants = await getDescendantPids(h.ptyPid)
        descendants.add(h.ptyPid)
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
        resourceUsage[h.shell.id] = {
          rss,
          cpu: Math.round(cpu * 10) / 10,
          pidCount,
        }
      } else if (h.sshHost && h.remotePid > 0 && hostProcs) {
        // Remote resource usage from already-fetched process data
        const descendants = getRemoteDescendantPids(hostProcs, h.remotePid)
        descendants.add(h.remotePid)
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
        resourceUsage[h.shell.id] = {
          rss,
          cpu: Math.round(cpu * 10) / 10,
          pidCount,
        }
      }

      // Clear stale active_cmd if no actual process found after multiple scans
      if (h.currentCommand) {
        if (procs.some((p) => p.source === 'direct' && p.pid > 0)) {
          h.staleScanCount = 0
        } else {
          h.staleScanCount++
          log.info(
            `[pty] t=${h.terminalId} s=${h.shell.id} stale scan ${h.staleScanCount}/3 for "${h.currentCommand}"`,
          )
          if (h.staleScanCount >= 3) {
            let shellAlive = false
            if (h.ptyPid > 0) {
              shellAlive = (await getProcessComm(h.ptyPid)) !== null
            } else if (h.sshHost && h.remotePid > 0) {
              // Check if remote shell PID exists in already-fetched data
              shellAlive =
                hostProcs?.some((p) => p.pid === h.remotePid) ?? false
            }
            if (shellAlive) {
              h.staleScanCount = 0
            } else {
              log.info(
                `[pty] t=${h.terminalId} s=${h.shell.id} clearing stale active_cmd "${h.currentCommand}"`,
              )
              h.currentCommand = null
              h.staleScanCount = 0
              emitShellUpdate(h.terminalId, h.shell.id, { active_cmd: null })
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
  // Use OS-level memory stats (memory pressure on macOS, MemAvailable on Linux)
  // instead of summing per-process RSS which double-counts shared memory
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

/** Reconcile SSH tunnels for the given terminal IDs and return portForwardStatus */
async function reconcileTunnelsForTerminals(
  terminalIds: number[],
  ports: Record<number, number[]>,
): Promise<Record<number, PortForwardStatus[]>> {
  const portForwardStatus: Record<number, PortForwardStatus[]> = {}
  // Find SSH terminal IDs from worker handles
  const allWorkers = getAllWorkers()
  const sshTerminalIds = new Set<number>()
  for (const h of allWorkers.values()) {
    if (h.sshHost && terminalIds.includes(h.terminalId)) {
      sshTerminalIds.add(h.terminalId)
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

export async function scanAndEmitProcessesForTerminal(terminalId: number) {
  const handles = getWorkersForTerminal(terminalId)
  if (handles.length === 0) return

  const result = await scanWorkers(handles)
  const { remoteProcesses: _, ...payload } = result

  // Reconcile SSH tunnels for this terminal
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
  const workers = getAllWorkers()
  const handles = [...workers.values()]
  const result = await scanWorkers(handles)

  // Check for active zellij sessions (local)
  try {
    const zellijSessions = await getActiveZellijSessionNames()
    if (zellijSessions.size > 0) {
      const sessionTerminalIds = new Set<number>()
      for (const h of workers.values()) {
        sessionTerminalIds.add(h.terminalId)
        if (
          zellijSessions.has(h.sessionName) ||
          zellijSessions.has(sanitizeName(h.sessionName))
        ) {
          result.processes.push({
            pid: 0,
            name: 'zellij',
            command: 'zellij',
            terminalId: h.terminalId,
            shellId: h.shell.id,
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
  for (const h of workers.values()) {
    if (h.sshHost && h.remotePid > 0) {
      const hostProcs = result.remoteProcesses.get(h.sshHost)
      if (hostProcs) {
        const serverPid = findRemoteZellijServerPid(hostProcs, h.remotePid)
        if (serverPid) {
          result.processes.push({
            pid: 0,
            name: 'zellij',
            command: 'zellij',
            terminalId: h.terminalId,
            shellId: h.shell.id,
            source: 'zellij',
            isZellij: true,
          })
        }
      }
    }
  }

  // Reconcile SSH tunnels for all terminals
  const allTerminalIds = [
    ...new Set([...workers.values()].map((h) => h.terminalId)),
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

function startGlobalProcessPolling() {
  if (globalProcessPollingId) return
  globalProcessPollingId = setInterval(scanAndEmitAllProcesses, 3000)
}

function stopGlobalProcessPolling() {
  if (globalProcessPollingId && getAllWorkers().size === 0) {
    clearInterval(globalProcessPollingId)
    globalProcessPollingId = null
  }
}

// ── Git dirty status polling ────────────────────────────────────────

let gitDirtyPollingId: NodeJS.Timeout | null = null
const lastDirtyStatus = new Map<
  number,
  { added: number; removed: number; untracked: number; untrackedLines: number }
>()
const lastRemoteSyncStatus = new Map<
  number,
  { behind: number; ahead: number; noRemote: boolean }
>()
const lastCommitStatus = new Map<number, GitLastCommit>()

function parseDiffNumstat(stdout: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts[0] !== '-') added += Number(parts[0]) || 0
    if (parts[1] !== '-') removed += Number(parts[1]) || 0
  }
  return { added, removed }
}

function countUntracked(stdout: string): number {
  if (!stdout.trim()) return 0
  return stdout.trim().split('\n').length
}

async function checkLastCommit(
  cwd: string,
  sshHost?: string | null,
): Promise<GitLastCommit | null> {
  try {
    let logOut: string
    let userName: string
    if (sshHost) {
      const [logResult, userResult] = await Promise.all([
        execSSHCommand(sshHost, 'git log -1 --format="%H%n%an%n%aI%n%s"', cwd),
        execSSHCommand(sshHost, 'git config user.name || true', cwd),
      ])
      logOut = logResult.stdout
      userName = userResult.stdout.trim()
    } else {
      ;[logOut, userName] = await Promise.all([
        new Promise<string>((resolve, reject) => {
          execFile(
            'git',
            ['log', '-1', '--format=%H%n%an%n%aI%n%s'],
            { cwd, timeout: 5000 },
            (err, out) => (err ? reject(err) : resolve(out)),
          )
        }),
        new Promise<string>((resolve) => {
          execFile(
            'git',
            ['config', 'user.name'],
            { cwd, timeout: 5000 },
            (err, out) => resolve(err ? '' : out.trim()),
          )
        }),
      ])
    }
    const lines = logOut.trim().split('\n')
    if (lines.length < 4) return null
    const author = lines[1]
    return {
      hash: lines[0],
      author,
      date: lines[2],
      subject: lines.slice(3).join('\n'),
      isLocal: !!userName && author === userName,
    }
  } catch {
    return null
  }
}

async function checkGitDirty(
  cwd: string,
  sshHost?: string | null,
): Promise<{
  added: number
  removed: number
  untracked: number
  untrackedLines: number
}> {
  const zero = { added: 0, removed: 0, untracked: 0, untrackedLines: 0 }
  try {
    if (sshHost) {
      const [diffResult, untrackedResult, untrackedLinesResult] =
        await Promise.all([
          execSSHCommand(
            sshHost,
            'git diff --numstat HEAD 2>/dev/null || git diff --numstat',
            cwd,
          ),
          execSSHCommand(
            sshHost,
            'git ls-files --others --exclude-standard',
            cwd,
          ),
          execSSHCommand(
            sshHost,
            'git ls-files -z --others --exclude-standard | xargs -0 cat 2>/dev/null | wc -l',
            cwd,
          ),
        ])
      const diff = parseDiffNumstat(diffResult.stdout)
      const untrackedLines =
        Number.parseInt(untrackedLinesResult.stdout.trim(), 10) || 0
      return {
        added: diff.added,
        removed: diff.removed,
        untracked: countUntracked(untrackedResult.stdout),
        untrackedLines,
      }
    }
    return await new Promise<{
      added: number
      removed: number
      untracked: number
      untrackedLines: number
    }>((resolve) => {
      let diff = { added: 0, removed: 0 }
      let untracked = 0
      let untrackedLines = 0
      let completed = 0
      const checkDone = () => {
        if (++completed === 3)
          resolve({
            added: diff.added,
            removed: diff.removed,
            untracked,
            untrackedLines,
          })
      }

      execFile(
        'git',
        ['diff', '--numstat', 'HEAD'],
        { cwd, timeout: 5000 },
        (err, stdout) => {
          if (err) {
            execFile(
              'git',
              ['diff', '--numstat'],
              { cwd, timeout: 5000 },
              (err2, stdout2) => {
                if (!err2) diff = parseDiffNumstat(stdout2)
                checkDone()
              },
            )
          } else {
            diff = parseDiffNumstat(stdout)
            checkDone()
          }
        },
      )

      execFile(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        { cwd, timeout: 5000 },
        (err, stdout) => {
          if (!err) untracked = countUntracked(stdout)
          checkDone()
        },
      )

      execFile(
        'sh',
        [
          '-c',
          'git ls-files -z --others --exclude-standard | xargs -0 cat 2>/dev/null | wc -l',
        ],
        { cwd, timeout: 5000 },
        (err, stdout) => {
          if (!err) untrackedLines = Number.parseInt(stdout.trim(), 10) || 0
          checkDone()
        },
      )
    })
  } catch (err) {
    log.error({ err, cwd }, '[pty] Failed to check git dirty status')
    return zero
  }
}

async function checkGitRemoteSync(
  cwd: string,
  sshHost?: string | null,
): Promise<{ behind: number; ahead: number; noRemote: boolean }> {
  const noRemote = { behind: 0, ahead: 0, noRemote: true }
  try {
    if (sshHost) {
      const refCmd =
        'REF=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || (git rev-parse --abbrev-ref HEAD | xargs -I {} git rev-parse --verify origin/{} >/dev/null 2>&1 && git rev-parse --abbrev-ref HEAD | xargs -I {} echo origin/{}))'
      const [behindResult, aheadResult] = await Promise.all([
        execSSHCommand(
          sshHost,
          `${refCmd}; [ -n "$REF" ] && git rev-list --count HEAD..$REF || true`,
          cwd,
        ),
        execSSHCommand(
          sshHost,
          `${refCmd}; [ -n "$REF" ] && git rev-list --count $REF..HEAD || true`,
          cwd,
        ),
      ])
      if (!behindResult.stdout.trim() || !aheadResult.stdout.trim()) {
        return noRemote
      }
      return {
        behind: Number.parseInt(behindResult.stdout.trim(), 10) || 0,
        ahead: Number.parseInt(aheadResult.stdout.trim(), 10) || 0,
        noRemote: false,
      }
    }
    return await new Promise<{
      behind: number
      ahead: number
      noRemote: boolean
    }>((resolve) => {
      execFile(
        'git',
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        { cwd, timeout: 5000 },
        (upstreamErr, upstreamRef) => {
          if (!upstreamErr && upstreamRef.trim()) {
            countRemoteSync(cwd, upstreamRef.trim(), resolve, noRemote)
          } else {
            execFile(
              'git',
              ['rev-parse', '--abbrev-ref', 'HEAD'],
              { cwd, timeout: 5000 },
              (branchErr, branch) => {
                if (branchErr || !branch.trim()) {
                  resolve(noRemote)
                  return
                }
                const remoteBranch = `origin/${branch.trim()}`
                execFile(
                  'git',
                  ['rev-parse', '--verify', remoteBranch],
                  { cwd, timeout: 5000 },
                  (verifyErr) => {
                    if (verifyErr) {
                      resolve(noRemote)
                    } else {
                      countRemoteSync(cwd, remoteBranch, resolve, noRemote)
                    }
                  },
                )
              },
            )
          }
        },
      )
    })
  } catch (err) {
    log.error({ err, cwd }, '[pty] Failed to check git remote sync')
    return noRemote
  }
}

function countRemoteSync(
  cwd: string,
  remoteRef: string,
  resolve: (value: {
    behind: number
    ahead: number
    noRemote: boolean
  }) => void,
  noRemote: { behind: number; ahead: number; noRemote: boolean },
) {
  let behind = 0
  let ahead = 0
  let completed = 0
  const checkDone = () => {
    if (++completed === 2) {
      resolve({ behind, ahead, noRemote: false })
    }
  }

  execFile(
    'git',
    ['rev-list', '--count', `HEAD..${remoteRef}`],
    { cwd, timeout: 5000 },
    (err, stdout) => {
      if (err) {
        resolve(noRemote)
        return
      }
      behind = Number.parseInt(stdout.trim(), 10) || 0
      checkDone()
    },
  )

  execFile(
    'git',
    ['rev-list', '--count', `${remoteRef}..HEAD`],
    { cwd, timeout: 5000 },
    (err, stdout) => {
      if (err) {
        resolve(noRemote)
        return
      }
      ahead = Number.parseInt(stdout.trim(), 10) || 0
      checkDone()
    },
  )
}

async function scanAndEmitGitDirty() {
  const currentStatus: Record<
    number,
    {
      added: number
      removed: number
      untracked: number
      untrackedLines: number
    }
  > = {}
  const currentSyncStatus: Record<
    number,
    { behind: number; ahead: number; noRemote: boolean }
  > = {}
  const currentLastCommit: Record<number, GitLastCommit> = {}
  const checks: Promise<void>[] = []

  try {
    const terminals = await getAllTerminals()
    for (const terminal of terminals) {
      if (!terminal.git_branch) continue
      if (terminal.ssh_host && getWorkersForTerminal(terminal.id).length === 0)
        continue
      checks.push(
        (async () => {
          try {
            const [stat, syncStat, commit] = await Promise.all([
              checkGitDirty(terminal.cwd, terminal.ssh_host),
              checkGitRemoteSync(terminal.cwd, terminal.ssh_host),
              checkLastCommit(terminal.cwd, terminal.ssh_host),
            ])
            currentStatus[terminal.id] = stat
            currentSyncStatus[terminal.id] = syncStat
            if (commit) currentLastCommit[terminal.id] = commit

            let branch: string | null = null
            if (terminal.ssh_host) {
              const result = await execSSHCommand(
                terminal.ssh_host,
                'git rev-parse --abbrev-ref HEAD 2>/dev/null || git symbolic-ref --short HEAD 2>/dev/null',
                terminal.cwd,
              )
              branch = result.stdout.trim() || null
            } else {
              branch = await new Promise<string | null>((resolve) => {
                execFile(
                  'git',
                  ['rev-parse', '--abbrev-ref', 'HEAD'],
                  { cwd: terminal.cwd },
                  (err, stdout) => {
                    if (!err && stdout?.trim()) return resolve(stdout.trim())
                    execFile(
                      'git',
                      ['symbolic-ref', '--short', 'HEAD'],
                      { cwd: terminal.cwd },
                      (err2, stdout2) => {
                        if (err2 || !stdout2) return resolve(null)
                        resolve(stdout2.trim() || null)
                      },
                    )
                  },
                )
              })
            }

            if (branch && branch !== terminal.git_branch) {
              await updateTerminal(terminal.id, { git_branch: branch })
              getIO()?.emit('terminal:updated', {
                terminalId: terminal.id,
                data: { git_branch: branch },
              })
            }
          } catch (err) {
            log.error(
              { err, terminalId: terminal.id },
              '[pty] Failed to detect branch for terminal',
            )
          }
        })(),
      )
    }
  } catch (err) {
    log.error({ err }, '[pty] Failed to detect terminal branches')
    return
  }

  await Promise.all(checks)

  lastDirtyStatus.clear()
  for (const [id, stat] of Object.entries(currentStatus)) {
    lastDirtyStatus.set(Number(id), stat)
  }

  lastRemoteSyncStatus.clear()
  for (const [id, stat] of Object.entries(currentSyncStatus)) {
    lastRemoteSyncStatus.set(Number(id), stat)
  }

  lastCommitStatus.clear()
  for (const [id, stat] of Object.entries(currentLastCommit)) {
    lastCommitStatus.set(Number(id), stat)
  }

  getIO()?.emit('git:dirty-status', {
    dirtyStatus: currentStatus,
    lastCommit: currentLastCommit,
  })
  getIO()?.emit('git:remote-sync', { syncStatus: currentSyncStatus })
}

export async function checkAndEmitSingleGitDirty(
  terminalId: number,
  force?: boolean,
) {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal || !terminal.git_branch) return

    const [stat, syncStat, commit] = await Promise.all([
      checkGitDirty(terminal.cwd, terminal.ssh_host),
      checkGitRemoteSync(terminal.cwd, terminal.ssh_host),
      checkLastCommit(terminal.cwd, terminal.ssh_host),
    ])

    const prevDirty = lastDirtyStatus.get(terminalId)
    const prevCommit = lastCommitStatus.get(terminalId)
    const dirtyChanged =
      !prevDirty ||
      prevDirty.added !== stat.added ||
      prevDirty.removed !== stat.removed ||
      prevDirty.untracked !== stat.untracked ||
      prevDirty.untrackedLines !== stat.untrackedLines
    const commitChanged = commit
      ? !prevCommit || prevCommit.hash !== commit.hash
      : false

    if (force || dirtyChanged || commitChanged) {
      lastDirtyStatus.set(terminalId, stat)
      if (commit) lastCommitStatus.set(terminalId, commit)
      const dirtyStatus: Record<
        number,
        {
          added: number
          removed: number
          untracked: number
          untrackedLines: number
        }
      > = {}
      for (const [id, s] of lastDirtyStatus) {
        dirtyStatus[id] = s
      }
      const lastCommit: Record<number, GitLastCommit> = {}
      for (const [id, s] of lastCommitStatus) {
        lastCommit[id] = s
      }
      getIO()?.emit('git:dirty-status', { dirtyStatus, lastCommit })
    }

    const prevSync = lastRemoteSyncStatus.get(terminalId)
    const syncChanged =
      !prevSync ||
      prevSync.behind !== syncStat.behind ||
      prevSync.ahead !== syncStat.ahead ||
      prevSync.noRemote !== syncStat.noRemote

    if (force || syncChanged) {
      lastRemoteSyncStatus.set(terminalId, syncStat)
      const syncStatus: Record<
        number,
        { behind: number; ahead: number; noRemote: boolean }
      > = {}
      for (const [id, s] of lastRemoteSyncStatus) {
        syncStatus[id] = s
      }
      getIO()?.emit('git:remote-sync', { syncStatus })
    }
  } catch (err) {
    log.error({ err }, '[pty] Failed to scan and emit git dirty status')
  }
}

export function startGitDirtyPolling() {
  if (gitDirtyPollingId) return
  scanAndEmitGitDirty()
  gitDirtyPollingId = setInterval(scanAndEmitGitDirty, 10000)
}

// ── Git branch detection ────────────────────────────────────────────

async function detectRepoSlug(
  cwd: string,
  sshHost: string | null,
): Promise<string | null> {
  let remoteUrl: string | null = null
  if (sshHost) {
    const result = await execSSHCommand(
      sshHost,
      'git remote get-url origin',
      cwd,
    )
    remoteUrl = result.stdout.trim() || null
  } else {
    remoteUrl = await new Promise<string | null>((resolve) => {
      execFile(
        'git',
        ['remote', 'get-url', 'origin'],
        { cwd },
        (err, stdout) => {
          if (err || !stdout) return resolve(null)
          resolve(stdout.trim() || null)
        },
      )
    })
  }

  if (remoteUrl) {
    const match = remoteUrl.match(
      /(?:github\.com[:/])([^/]+\/[^/.]+?)(?:\.git)?$/,
    )
    if (match) return match[1]
  }

  const ghUser = getGhUsername()
  const folderName = cwd.split('/').filter(Boolean).pop()
  if (ghUser && folderName) return `${ghUser}/${folderName}`

  return null
}

export async function detectGitBranch(
  terminalId: number,
  options?: { skipPRRefresh?: boolean },
) {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal) return

    let branch: string | null = null

    if (terminal.ssh_host) {
      const result = await execSSHCommand(
        terminal.ssh_host,
        'git rev-parse --abbrev-ref HEAD 2>/dev/null || git symbolic-ref --short HEAD 2>/dev/null',
        terminal.cwd,
      )
      branch = result.stdout.trim() || null
    } else {
      branch = await new Promise<string | null>((resolve) => {
        execFile(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: terminal.cwd },
          (err, stdout) => {
            if (!err && stdout?.trim()) return resolve(stdout.trim())
            execFile(
              'git',
              ['symbolic-ref', '--short', 'HEAD'],
              { cwd: terminal.cwd },
              (err2, stdout2) => {
                if (err2 || !stdout2) return resolve(null)
                resolve(stdout2.trim() || null)
              },
            )
          },
        )
      })
    }

    if (branch) {
      await updateTerminal(terminalId, { git_branch: branch })
      getIO()?.emit('terminal:updated', {
        terminalId,
        data: { git_branch: branch },
      })
      if (!options?.skipPRRefresh) {
        refreshPRChecks()
      }

      if (!terminal.git_repo) {
        try {
          const repo = await detectRepoSlug(terminal.cwd, terminal.ssh_host)
          if (repo) {
            const gitRepo = { repo, status: 'done' as const }
            await updateTerminal(terminalId, { git_repo: gitRepo })
            await emitWorkspace(terminalId, { git_repo: gitRepo })
          }
        } catch (err) {
          log.error({ err, terminalId }, '[pty] Failed to detect repo slug')
        }
      }
    }
  } catch (err) {
    log.error(
      { err },
      `[pty] Failed to detect git branch for terminal ${terminalId}`,
    )
  }
}

// ── File helpers ────────────────────────────────────────────────────

const WORKIO_TERMINALS_DIR = path.join(os.homedir(), '.workio', 'terminals')
const WORKIO_SHELLS_DIR = path.join(os.homedir(), '.workio', 'shells')
const WORKIO_INTEGRATION_DIR = path.join(
  os.homedir(),
  '.workio',
  'shell-integration',
)

export async function writeShellIntegrationScripts(): Promise<void> {
  const srcDir = path.join(__dirname, 'shell-integration')
  await fs.promises.mkdir(WORKIO_INTEGRATION_DIR, { recursive: true })
  const files = ['bash.sh', 'zsh.sh', 'ssh-inline.sh']
  await Promise.all(
    files.map(async (file) => {
      const content = await fs.promises.readFile(
        path.join(srcDir, file),
        'utf-8',
      )
      await fs.promises.writeFile(
        path.join(WORKIO_INTEGRATION_DIR, file),
        content,
        { mode: 0o644 },
      )
    }),
  )
  log.info(
    `[pty] Shell integration scripts written to ${WORKIO_INTEGRATION_DIR}`,
  )
}

export async function writeTerminalNameFile(
  terminalId: number,
  name: string,
): Promise<void> {
  try {
    await fs.promises.mkdir(WORKIO_TERMINALS_DIR, { recursive: true })
    await fs.promises.writeFile(
      path.join(WORKIO_TERMINALS_DIR, String(terminalId)),
      sanitizeName(name),
    )
  } catch (err) {
    log.error(
      { err },
      `[pty] Failed to write terminal name file for ${terminalId}`,
    )
  }
}

export async function writeShellNameFile(
  shellId: number,
  name: string,
): Promise<void> {
  try {
    await fs.promises.mkdir(WORKIO_SHELLS_DIR, { recursive: true })
    await fs.promises.writeFile(
      path.join(WORKIO_SHELLS_DIR, String(shellId)),
      sanitizeName(name),
    )
  } catch (err) {
    log.error({ err }, `[pty] Failed to write shell name file for ${shellId}`)
  }
}

export function renameZellijSession(
  oldName: string,
  newName: string,
  sshHost?: string | null,
) {
  if (sshHost) {
    return execSSHCommand(
      sshHost,
      `zellij --session ${shellEscape(oldName)} action rename-session ${shellEscape(newName)}`,
      { timeout: 5000 },
    ).then(
      () =>
        log.info(
          `[pty] Renamed zellij session ${oldName} to ${newName} on ${sshHost}`,
        ),
      () => {},
    )
  }
  return new Promise<void>((resolve) => {
    execFile(
      'zellij',
      ['--session', oldName, 'action', 'rename-session', newName],
      { timeout: 5000 },
      (err) => {
        if (!err) {
          log.info(`[pty] Renamed zellij session ${oldName} to ${newName}`)
        }
        resolve()
      },
    )
  })
}

// ── Wrapped destroy with cleanup ────────────────────────────────────

export function destroySession(shellId: number): boolean {
  const result = proxyDestroySession(shellId)
  if (result) {
    bellSubscriptions.delete(shellId)
    stopGlobalProcessPolling()
  }
  return result
}

export function destroySessionsForTerminal(terminalId: number): boolean {
  // Get the shell IDs before destroying so we can clean up bell subs
  const handles = getWorkersForTerminal(terminalId)
  // Check if this terminal's SSH host is used by other terminals
  const sshHost = handles.find((h) => h.sshHost)?.sshHost
  const result = proxyDestroySessionsForTerminal(terminalId)
  if (result) {
    for (const h of handles) {
      bellSubscriptions.delete(h.shellId)
    }
    lastDirtyStatus.delete(terminalId)
    lastRemoteSyncStatus.delete(terminalId)
    stopGlobalProcessPolling()
    untrackTerminal(terminalId)
    stopAllTunnelsForTerminal(terminalId)

    // Close SSH pool connection and clear cache if no other terminals use the same host
    if (sshHost) {
      const allWorkers = getAllWorkers()
      const otherUsesHost = [...allWorkers.values()].some(
        (w) => w.sshHost === sshHost,
      )
      if (!otherUsesHost) {
        closeConnection(sshHost)
        sshHostInfoCache.delete(sshHost)
      }
    }
  }
  return result
}

// ── Worker command event handler ────────────────────────────────────
// Called by session-proxy when a worker sends a command-event IPC message.

function handleWorkerCommandEvent(
  terminalId: number,
  shellId: number,
  event: CommandEvent,
  handle: WorkerHandle,
) {
  switch (event.type) {
    case 'command_start':
      log.info(
        `[pty] t=${terminalId} s=${shellId} Command start: "${event.command}"`,
      )
      handle.staleScanCount = 0
      emitShellUpdate(terminalId, shellId, {
        active_cmd: event.command || null,
      })
      // Debounced process poll
      {
        const existing = processPollTimeoutIds.get(terminalId)
        if (existing) clearTimeout(existing)
        processPollTimeoutIds.set(
          terminalId,
          setTimeout(() => {
            processPollTimeoutIds.delete(terminalId)
            scanAndEmitProcessesForTerminal(terminalId)
          }, 1000),
        )
      }
      break

    case 'command_end': {
      log.info(
        `[pty] t=${terminalId} s=${shellId} Command end: "${handle.currentCommand}"`,
      )
      emitShellUpdate(terminalId, shellId, { active_cmd: null })
      const existing = processPollTimeoutIds.get(terminalId)
      if (existing) {
        clearTimeout(existing)
        processPollTimeoutIds.delete(terminalId)
      }

      detectGitBranch(terminalId)
      checkAndEmitSingleGitDirty(terminalId)
      setTimeout(() => {
        scanAndEmitProcessesForTerminal(terminalId)
      }, 1000)

      // Bell notification
      const bellSub = bellSubscriptions.get(shellId)
      if (bellSub) {
        bellSubscriptions.delete(shellId)
        const command = handle.currentCommand || bellSub.command
        getIO()?.emit('bell:notify', {
          shellId,
          terminalId,
          command,
          terminalName: bellSub.terminalName,
          exitCode: event.exitCode,
        })
        const resolved = resolveNotification('bell_notify', {
          command,
          terminalName: bellSub.terminalName,
          exitCode: event.exitCode,
        })
        sendPushNotification({
          title: `${resolved.emoji} ${resolved.title}`,
          body: resolved.body,
          tag: `bell:${shellId}`,
        })
        getIO()?.emit('bell:subscriptions', getBellSubscribedShellIds())
      }
      break
    }

    case 'remote_pid':
      if (event.remotePid && event.remotePid > 0) {
        handle.remotePid = event.remotePid
        log.info(
          `[pty] t=${terminalId} s=${shellId} Remote PID: ${event.remotePid}`,
        )
      }
      break

    case 'done_marker':
      // done_marker is handled by the proxy's onDoneMarker callback
      break
  }
}

// Register the command event handler with the session proxy
setCommandEventHandler(handleWorkerCommandEvent)

// Start process polling when module loads (sessions may exist from proxy)
startGlobalProcessPolling()
