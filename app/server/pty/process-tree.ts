import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'
import type { ActiveProcess } from '../../shared/types'
import { log } from '../logger'
import { poolExecSSHCommand } from '../ssh/pool'

const execFileAsync = promisify(execFileCb)

export async function getChildPids(pid: number): Promise<number[]> {
  try {
    // Try Linux /proc first (faster, no process spawn)
    const childrenPath = `/proc/${pid}/task/${pid}/children`
    if (fs.existsSync(childrenPath)) {
      const content = fs.readFileSync(childrenPath, 'utf8').trim()
      return content ? content.split(' ').map(Number) : []
    }
  } catch {
    // Fall through to pgrep
  }

  // Fallback to pgrep (macOS + Linux)
  try {
    const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)], {
      encoding: 'utf8',
      timeout: 500,
    })
    const output = stdout.trim()
    return output ? output.split('\n').map(Number) : []
  } catch {
    return []
  }
}

export async function getProcessComm(pid: number): Promise<string | null> {
  try {
    // Try Linux /proc first
    const commPath = `/proc/${pid}/comm`
    if (fs.existsSync(commPath)) {
      return fs.readFileSync(commPath, 'utf8').trim()
    }
  } catch {
    // Fall through to ps
  }

  // Fallback to ps
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'comm=', '-p', String(pid)],
      {
        encoding: 'utf8',
        timeout: 500,
      },
    )
    return stdout.trim()
  } catch {
    return null
  }
}

// Get full command line with arguments
async function getProcessArgs(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'args=', '-p', String(pid)],
      {
        encoding: 'utf8',
        timeout: 500,
      },
    )
    return stdout.trim()
  } catch {
    return null
  }
}

// Processes to ignore - shells, multiplexers, and shell helpers
const IGNORE_PROCESSES = new Set([
  // Shells
  'zsh',
  'bash',
  'sh',
  'fish',
  'dash',
  'ksh',
  'csh',
  'tcsh',
  // Multiplexers
  'zellij',
  'tmux',
  'screen',
  // System
  'login',
  'sshd',
  'sudo',
  'su',
  // Shell helpers/plugins
  'gitstatusd',
  'fzf',
  'claude',
  'sleep',
  'gitstatusd-darwin-arm64',
  'gitstatusd-linux-x86_64',
])

const IGNORE_PARTIAL = ['bash']

// Check if process should be ignored (handles full paths like /bin/zsh)
function shouldIgnoreProcess(name: string): boolean {
  if (IGNORE_PARTIAL.some((partial) => name.includes(partial))) return true
  if (IGNORE_PROCESSES.has(name)) return true
  // Check basename for full paths
  const basename = name.split('/').pop() || name
  if (IGNORE_PROCESSES.has(basename)) return true
  // Check if it's a gitstatusd variant
  if (basename.startsWith('gitstatusd')) return true
  return false
}

// Get the TTY of a process
async function getProcessTty(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'tty=', '-p', String(pid)],
      {
        encoding: 'utf8',
        timeout: 500,
      },
    )
    const output = stdout.trim()
    return output || null
  } catch {
    return null
  }
}

// Get all processes on a specific TTY
async function getProcessesOnTty(tty: string): Promise<Map<number, string>> {
  const pidToName = new Map<number, string>()
  try {
    // ps -t <tty> -o pid=,comm= gives all processes on that TTY
    const { stdout } = await execFileAsync(
      'ps',
      ['-t', tty, '-o', 'pid=,comm='],
      {
        encoding: 'utf8',
        timeout: 1000,
      },
    )

    for (const line of stdout.trim().split('\n')) {
      try {
        const match = line.trim().match(/^(\d+)\s+(.+)$/)
        if (match) {
          const pid = Number.parseInt(match[1], 10)
          const name = match[2].trim()
          if (pid && name) {
            pidToName.set(pid, name)
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // ps failed
  }
  return pidToName
}

// Zellij session detection
export interface ZellijPaneProcess {
  pid: number
  command: string
  isIdle: boolean
  terminalId?: number
}

// Find Zellij server PID for a given session name
async function findZellijServerForSession(
  sessionName: string,
): Promise<number | null> {
  try {
    // Get all Zellij server PIDs (PPID=1)
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        "ps -axo pid,ppid,comm | awk '$3 ~ /zellij/ && $2 == 1 {print $1}'",
      ],
      { encoding: 'utf8', timeout: 1000 },
    )
    const output = stdout.trim()

    if (!output) return null

    const serverPids = output.split('\n').map(Number)

    const results = await Promise.all(
      serverPids.map(async (serverPid) => {
        try {
          const { stdout: lsofOutput } = await execFileAsync(
            'lsof',
            ['-p', String(serverPid)],
            { encoding: 'utf8', timeout: 2000 },
          )
          const match = lsofOutput.match(/unix.*zellij-\d+[^\s]*\/([^\s]+)/)
          if (match && match[1] === sessionName) {
            return serverPid
          }
        } catch {
          // Skip this server
        }
        return null
      }),
    )
    const matched = results.find((pid) => pid !== null)
    if (matched != null) return matched
  } catch {
    // Failed to find servers
  }
  return null
}

// Get running commands in all panes of a Zellij session
export async function getZellijSessionProcesses(
  sessionName: string,
  terminalId?: number,
): Promise<ZellijPaneProcess[]> {
  try {
    const serverPid = await findZellijServerForSession(sessionName)
    if (!serverPid) return []

    const results: ZellijPaneProcess[] = []

    // Get all pane shells (direct children of server)
    const paneShells = await getChildPids(serverPid)

    const shellResults = await Promise.all(
      paneShells.map(async (shellPid) => {
        const [shellComm, shellArgs, cmdPids] = await Promise.all([
          getProcessComm(shellPid),
          getProcessArgs(shellPid),
          getChildPids(shellPid),
        ])

        if (cmdPids.length > 0) {
          const cmdArgsList = await Promise.all(
            cmdPids.map(async (cmdPid) => {
              try {
                return { cmdPid, cmdArgs: await getProcessArgs(cmdPid) }
              } catch {
                return { cmdPid, cmdArgs: null }
              }
            }),
          )
          return cmdArgsList
            .filter(
              (r): r is { cmdPid: number; cmdArgs: string } =>
                r.cmdArgs != null && !shouldIgnoreProcess(r.cmdArgs),
            )
            .map((r) => ({
              pid: r.cmdPid,
              command: r.cmdArgs,
              isIdle: false,
              terminalId,
            }))
        }
        // No children - auto-started command via zellij layout `command` directive
        // runs directly as a child of the server, not wrapped in a shell
        const isIgnored = shellComm ? shouldIgnoreProcess(shellComm) : true
        if (!isIgnored && shellArgs) {
          return [
            {
              pid: shellPid,
              command: shellArgs,
              isIdle: false,
              terminalId,
            },
          ]
        }
        return []
      }),
    )
    for (const procs of shellResults) {
      results.push(...procs)
    }

    return results
  } catch (error) {
    log.error({ err: error }, 'Error getting Zellij session processes')
    return []
  }
}

// Get all descendant PIDs of a process (recursive)
export async function getDescendantPids(pid: number): Promise<Set<number>> {
  const descendants = new Set<number>()
  const visit = async (p: number) => {
    if (descendants.has(p)) return
    descendants.add(p)
    const children = await getChildPids(p)
    await Promise.all(children.map((child) => visit(child)))
  }
  const children = await getChildPids(pid)
  await Promise.all(children.map((child) => visit(child)))
  return descendants
}

// Get system-wide RSS (KB) and CPU% for every process in a single ps call
// Returns Map<pid, { rss, cpu }>
export async function getSystemResourceUsage(): Promise<
  Map<number, { rss: number; cpu: number }>
> {
  const result = new Map<number, { rss: number; cpu: number }>()
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'pid,rss,%cpu', '-ax'],
      { encoding: 'utf8', timeout: 3000 },
    )
    // Skip the header line
    for (const line of stdout.split('\n').slice(1)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split(/\s+/)
      if (parts.length < 3) continue
      const pid = Number.parseInt(parts[0], 10)
      const rss = Number.parseInt(parts[1], 10)
      const cpu = Number.parseFloat(parts[2])
      if (pid > 0) {
        result.set(pid, { rss, cpu })
      }
    }
  } catch (err) {
    log.error({ err }, '[pty] Failed to get system resource usage')
  }
  return result
}

// Get all TCP listening ports on the system, grouped by PID
// Returns Map<pid, port[]>
export async function getSystemListeningPorts(): Promise<
  Map<number, number[]>
> {
  const pidPorts = new Map<number, number[]>()
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-iTCP', '-sTCP:LISTEN', '-P', '-n', '-Fpn'],
      { encoding: 'utf8', timeout: 3000 },
    )

    let currentPid: number | null = null
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        currentPid = Number.parseInt(line.slice(1), 10)
      } else if (line.startsWith('n') && currentPid !== null) {
        // Format: n*:3000 or n127.0.0.1:3000 or n[::1]:3000
        const portMatch = line.match(/:(\d+)$/)
        if (portMatch) {
          const port = Number.parseInt(portMatch[1], 10)
          const existing = pidPorts.get(currentPid)
          if (existing) {
            if (!existing.includes(port)) existing.push(port)
          } else {
            pidPorts.set(currentPid, [port])
          }
        }
      }
    }
  } catch {
    // lsof failed or not available
  }
  return pidPorts
}

// Get listening ports for a terminal by intersecting its descendant PIDs
// with the system-wide listening ports map.
// shellPid: the terminal's shell PID (0 for SSH)
// zellijSessionName: optional Zellij session name to also check server descendants
export async function getListeningPortsForTerminal(
  shellPid: number,
  zellijSessionName: string | null,
  systemPorts: Map<number, number[]>,
): Promise<number[]> {
  if (systemPorts.size === 0) return []

  const allPids = new Set<number>()

  // Collect descendants from the shell process tree
  if (shellPid > 0) {
    for (const pid of await getDescendantPids(shellPid)) {
      allPids.add(pid)
    }
  }

  // Also collect descendants from Zellij server (processes run under the
  // server daemon, not the client terminal)
  if (zellijSessionName) {
    const serverPid = await findZellijServerForSession(zellijSessionName)
    if (serverPid) {
      for (const pid of await getDescendantPids(serverPid)) {
        allPids.add(pid)
      }
    }
  }

  if (allPids.size === 0) return []

  const ports = new Set<number>()
  for (const pid of allPids) {
    const pidPorts = systemPorts.get(pid)
    if (pidPorts) {
      for (const port of pidPorts) {
        ports.add(port)
      }
    }
  }

  return [...ports].sort((a, b) => a - b)
}

// Get all active zellij session names via `zellij list-sessions`
export async function getActiveZellijSessionNames(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('zellij', ['list-sessions', '-ns'], {
      encoding: 'utf8',
      timeout: 2000,
    })
    const names = new Set<string>()
    for (const line of stdout.trim().split('\n')) {
      const name = line.trim()
      if (name) names.add(name)
    }
    return names
  } catch {
    return new Set()
  }
}

// ── Remote process scanning (SSH) ──────────────────────────────────

export interface RemoteProcessInfo {
  pid: number
  ppid: number
  rss: number
  cpu: number
  comm: string
}

/**
 * Run a single `ps` on a remote host via pooled SSH connection.
 * Returns all processes with pid, ppid, rss, cpu%, and command name.
 */
export async function getRemoteProcessList(
  sshHost: string,
): Promise<RemoteProcessInfo[]> {
  const processes: RemoteProcessInfo[] = []
  try {
    const { stdout } = await poolExecSSHCommand(
      sshHost,
      'ps -axo pid=,ppid=,rss=,%cpu=,comm=',
      { timeout: 5000 },
    )
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split(/\s+/)
      if (parts.length < 5) continue
      const pid = Number.parseInt(parts[0], 10)
      const ppid = Number.parseInt(parts[1], 10)
      const rss = Number.parseInt(parts[2], 10)
      const cpu = Number.parseFloat(parts[3])
      const comm = parts.slice(4).join(' ')
      if (pid > 0) {
        processes.push({ pid, ppid, rss, cpu, comm })
      }
    }
  } catch (err) {
    log.error(
      { err },
      `[pty] Failed to get remote process list from ${sshHost}`,
    )
  }
  return processes
}

/**
 * Walk the ppid tree from rootPid to find all descendant PIDs.
 * Pure computation — no I/O.
 */
export function getRemoteDescendantPids(
  processes: RemoteProcessInfo[],
  rootPid: number,
): Set<number> {
  // Build ppid → children lookup
  const childrenMap = new Map<number, number[]>()
  for (const p of processes) {
    const existing = childrenMap.get(p.ppid)
    if (existing) {
      existing.push(p.pid)
    } else {
      childrenMap.set(p.ppid, [p.pid])
    }
  }

  const descendants = new Set<number>()
  const queue = childrenMap.get(rootPid) || []
  while (queue.length > 0) {
    const pid = queue.pop()!
    if (descendants.has(pid)) continue
    descendants.add(pid)
    const children = childrenMap.get(pid)
    if (children) {
      for (const child of children) {
        queue.push(child)
      }
    }
  }
  return descendants
}

/**
 * Find the Zellij server PID associated with a remote shell.
 * The user launches `zellij` from remotePid's shell, so the client is a
 * descendant of remotePid. The server is a daemon (ppid=1). We walk down
 * from remotePid to find the client, then locate the server.
 * Pure computation, no I/O.
 */
export function findRemoteZellijServerPid(
  processes: RemoteProcessInfo[],
  remotePid: number,
): number | null {
  // Check descendants of remotePid for a zellij client
  const descendants = getRemoteDescendantPids(processes, remotePid)
  let foundClient = false
  for (const pid of descendants) {
    const proc = processes.find((p) => p.pid === pid)
    if (!proc) continue
    const basename = proc.comm.split('/').pop() || proc.comm
    if (basename === 'zellij') {
      foundClient = true
      // If this is the server itself (ppid=1), return directly
      if (proc.ppid === 1) return proc.pid
      break
    }
  }

  if (!foundClient) return null

  // Found a client — find the server(s) (zellij with ppid=1)
  const servers: number[] = []
  for (const p of processes) {
    const b = p.comm.split('/').pop() || p.comm
    if (b === 'zellij' && p.ppid === 1) servers.push(p.pid)
  }
  // Only return if exactly one server — can't disambiguate multiple
  return servers.length === 1 ? servers[0] : null
}

/**
 * Get running commands in all panes of a remote Zellij session.
 * Pure computation on already-fetched remote process data — zero SSH calls.
 */
export function getRemoteZellijSessionProcesses(
  processes: RemoteProcessInfo[],
  remotePid: number,
  terminalId?: number,
): ZellijPaneProcess[] {
  const serverPid = findRemoteZellijServerPid(processes, remotePid)
  if (!serverPid) return []

  const results: ZellijPaneProcess[] = []

  // Get direct children of server (pane shells)
  const paneShells = processes.filter((p) => p.ppid === serverPid)

  for (const shell of paneShells) {
    const children = processes.filter((p) => p.ppid === shell.pid)

    if (children.length > 0) {
      // Pane shell has children — those are the actual commands
      for (const child of children) {
        const basename = child.comm.split('/').pop() || child.comm
        if (!shouldIgnoreProcess(basename)) {
          results.push({
            pid: child.pid,
            command: child.comm,
            isIdle: false,
            terminalId,
          })
        }
      }
    } else {
      // No children — auto-started command via zellij layout `command` directive
      const basename = shell.comm.split('/').pop() || shell.comm
      if (!shouldIgnoreProcess(basename)) {
        results.push({
          pid: shell.pid,
          command: shell.comm,
          isIdle: false,
          terminalId,
        })
      }
    }
  }

  return results
}

export async function getChildProcesses(
  shellPid: number,
  terminalId?: number,
): Promise<ActiveProcess[]> {
  try {
    const pidToName = new Map<number, string>()

    // Method 1: Get all descendants of our shell (follows through multiplexers)
    const collectDescendants = async (
      pid: number,
      visited = new Set<number>(),
    ): Promise<void> => {
      if (visited.has(pid)) return
      visited.add(pid)
      const childPids = await getChildPids(pid)
      await Promise.all(
        childPids.map(async (childPid) => {
          try {
            const name = await getProcessComm(childPid)
            if (name) pidToName.set(childPid, name)
            await collectDescendants(childPid, visited)
          } catch {
            // Skip
          }
        }),
      )
    }
    await collectDescendants(shellPid)

    // Method 2: Also get processes on our TTY (catches things that might not be direct descendants)
    const tty = await getProcessTty(shellPid)
    if (tty && tty !== '??') {
      const ttyProcesses = await getProcessesOnTty(tty)
      for (const [pid, name] of ttyProcesses) {
        if (!pidToName.has(pid)) {
          pidToName.set(pid, name)
        }
      }
    }

    // Build results
    const results: ActiveProcess[] = []
    const seen = new Set<string>()

    // Filter out shell and ignored processes, then fetch args in parallel
    const candidates = [...pidToName].filter(
      ([pid, name]) => pid !== shellPid && !shouldIgnoreProcess(name),
    )
    const argsResults = await Promise.all(
      candidates.map(async ([pid, name]) => ({
        pid,
        name,
        command: (await getProcessArgs(pid)) || name,
      })),
    )
    for (const { pid, name, command } of argsResults) {
      if (shouldIgnoreProcess(command)) continue
      if (!seen.has(command)) {
        seen.add(command)
        results.push({ pid, name, command, terminalId, source: 'direct' })
      }
    }

    return results
  } catch (error) {
    log.error({ err: error }, 'Error getting child processes')
    return []
  }
}
