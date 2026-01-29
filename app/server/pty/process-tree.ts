import { execSync } from 'node:child_process'
import fs from 'node:fs'
import type { ActiveProcess } from '../../shared/types'

export function getChildPids(pid: number): number[] {
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
    const output = execSync(`pgrep -P ${pid}`, {
      encoding: 'utf8',
      timeout: 500,
    }).trim()
    return output ? output.split('\n').map(Number) : []
  } catch {
    return []
  }
}

export function getProcessComm(pid: number): string | null {
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
    return execSync(`ps -o comm= -p ${pid}`, {
      encoding: 'utf8',
      timeout: 500,
    }).trim()
  } catch {
    return null
  }
}

// Get full command line with arguments
function getProcessArgs(pid: number): string | null {
  try {
    return execSync(`ps -o args= -p ${pid}`, {
      encoding: 'utf8',
      timeout: 500,
    }).trim()
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
function getProcessTty(pid: number): string | null {
  try {
    const output = execSync(`ps -o tty= -p ${pid}`, {
      encoding: 'utf8',
      timeout: 500,
    }).trim()
    return output || null
  } catch {
    return null
  }
}

// Get all processes on a specific TTY
function getProcessesOnTty(tty: string): Map<number, string> {
  const pidToName = new Map<number, string>()
  try {
    // ps -t <tty> -o pid=,comm= gives all processes on that TTY
    const output = execSync(`ps -t ${tty} -o pid=,comm=`, {
      encoding: 'utf8',
      timeout: 1000,
    })

    for (const line of output.trim().split('\n')) {
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
  command: string
  isIdle: boolean
  terminalId?: number
}

// Find Zellij server PID for a given session name
function findZellijServerForSession(sessionName: string): number | null {
  try {
    // Get all Zellij server PIDs (PPID=1)
    const output = execSync(
      "ps -axo pid,ppid,comm | awk '$3 ~ /zellij/ && $2 == 1 {print $1}'",
      { encoding: 'utf8', timeout: 1000 },
    ).trim()

    if (!output) return null

    const serverPids = output.split('\n').map(Number)

    for (const serverPid of serverPids) {
      try {
        // Check socket path to get session name
        const lsofOutput = execSync(`lsof -p ${serverPid} 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 2000,
        })

        // Look for unix socket with session name in path
        const match = lsofOutput.match(/unix.*zellij-\d+[^\s]*\/([^\s]+)/)
        if (match && match[1] === sessionName) {
          return serverPid
        }
      } catch {
        // Skip this server
      }
    }
  } catch {
    // Failed to find servers
  }
  return null
}

// Get running commands in all panes of a Zellij session
export function getZellijSessionProcesses(
  sessionName: string,
  terminalId?: number,
): ZellijPaneProcess[] {
  try {
    const serverPid = findZellijServerForSession(sessionName)
    if (!serverPid) return []

    const results: ZellijPaneProcess[] = []

    // Get all pane shells (direct children of server)
    const paneShells = getChildPids(serverPid)

    for (const shellPid of paneShells) {
      const shellComm = getProcessComm(shellPid)
      const shellArgs = getProcessArgs(shellPid)

      // Get first child of the shell (the running command)
      const cmdPids = getChildPids(shellPid)

      if (cmdPids.length > 0) {
        for (const cmdPid of cmdPids) {
          try {
            const cmdArgs = execSync(`ps -o args= -p ${cmdPid}`, {
              encoding: 'utf8',
              timeout: 500,
            }).trim()
            if (!shouldIgnoreProcess(cmdArgs)) {
              results.push({ command: cmdArgs, isIdle: false, terminalId })
            }
          } catch {
            // Process may have exited
          }
        }
      } else {
        // No children - auto-started command via zellij layout `command` directive
        // runs directly as a child of the server, not wrapped in a shell
        const isIgnored = shellComm ? shouldIgnoreProcess(shellComm) : true
        if (!isIgnored && shellArgs) {
          results.push({ command: shellArgs, isIdle: false, terminalId })
        }
      }
    }

    return results
  } catch (error) {
    console.error('Error getting Zellij session processes', error)
    return []
  }
}

// Check if a Zellij session exists for a terminal
export function hasZellijSession(terminalId: number): boolean {
  const sessionName = `terminal-${terminalId}`
  return findZellijServerForSession(sessionName) !== null
}

export function getChildProcesses(
  shellPid: number,
  terminalId?: number,
): ActiveProcess[] {
  try {
    const pidToName = new Map<number, string>()

    // Method 1: Get all descendants of our shell (follows through multiplexers)
    const collectDescendants = (
      pid: number,
      visited = new Set<number>(),
    ): void => {
      if (visited.has(pid)) return
      visited.add(pid)
      for (const childPid of getChildPids(pid)) {
        try {
          const name = getProcessComm(childPid)
          if (name) pidToName.set(childPid, name)
          collectDescendants(childPid, visited)
        } catch {
          // Skip
        }
      }
    }
    collectDescendants(shellPid)

    // Method 2: Also get processes on our TTY (catches things that might not be direct descendants)
    const tty = getProcessTty(shellPid)
    if (tty && tty !== '??') {
      const ttyProcesses = getProcessesOnTty(tty)
      for (const [pid, name] of ttyProcesses) {
        if (!pidToName.has(pid)) {
          pidToName.set(pid, name)
        }
      }
    }

    // Build results
    const results: ActiveProcess[] = []
    const seen = new Set<string>()

    for (const [pid, name] of pidToName) {
      // Skip our shell and ignored processes
      if (pid === shellPid) continue
      if (shouldIgnoreProcess(name)) continue

      const command = getProcessArgs(pid) || name
      if (shouldIgnoreProcess(command)) continue

      if (!seen.has(command)) {
        seen.add(command)
        results.push({ pid, name, command, terminalId, source: 'direct' })
      }
    }

    return results
  } catch (error) {
    console.error('Error getting child processes', error)
    return []
  }
}
