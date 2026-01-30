import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pty from 'node-pty'
import type { ActiveProcess } from '../../shared/types'
import { getSettings, getTerminalById, updateTerminal } from '../db'
import {
  refreshPRChecks,
  startChecksPolling,
  trackTerminal,
  untrackTerminal,
} from '../github/checks'
import { getIO } from '../io'
import { log } from '../logger'
import { validateSSHHost } from '../ssh/config'
import { execSSHCommand } from '../ssh/exec'
import { createSSHSession, type TerminalBackend } from '../ssh/ssh-pty-adapter'
import { type CommandEvent, createOscParser } from './osc-parser'
import { getZellijSessionProcesses } from './process-tree'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MAX_BUFFER_LINES = 5000
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

const COMMAND_IGNORE_LIST = ['claude']

export interface PtySession {
  pty: TerminalBackend
  buffer: string[]
  timeoutId: NodeJS.Timeout | null
  terminalId: number
  cols: number
  rows: number
  onData: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
  onCommandEvent: ((event: CommandEvent) => void) | null
  currentCommand: string | null
  isIdle: boolean
  lastActiveProcesses: string // For change detection
}

// In-memory map of active PTY sessions
const sessions = new Map<number, PtySession>()

// Global process polling
let globalProcessPollingId: NodeJS.Timeout | null = null

function getProcessesForTerminal(
  terminalId: number,
  session: PtySession,
): ActiveProcess[] {
  const processes: ActiveProcess[] = []

  try {
    if (
      session.currentCommand &&
      !COMMAND_IGNORE_LIST.includes(session.currentCommand)
    ) {
      processes.push({
        pid: 0,
        name: session.currentCommand.split(' ')[0] || '',
        command: session.currentCommand,
        terminalId: terminalId,
        source: 'direct',
      })
    }

    // Check Zellij session (terminal-<ID>)
    const zellijProcs = getZellijSessionProcesses(
      `terminal-${terminalId}`,
      terminalId,
    )
    for (const p of zellijProcs.filter((p) => !p.isIdle)) {
      processes.push({
        pid: 0,
        name: p.command.split(' ')[0] || '',
        command: p.command,
        terminalId: p.terminalId,
        source: 'zellij',
      })
    }
  } catch {
    // Ignore errors
  }

  return processes
}

function scanAndEmitProcessesForTerminal(terminalId: number) {
  const session = sessions.get(terminalId)
  if (!session) return

  const processes = getProcessesForTerminal(terminalId, session)
  getIO()?.emit('processes', { terminalId, processes })
}

function scanAndEmitAllProcesses() {
  const allProcesses: ActiveProcess[] = []

  for (const [terminalId, session] of sessions) {
    const procs = getProcessesForTerminal(terminalId, session)
    allProcesses.push(...procs)
  }

  getIO()?.emit('processes', { processes: allProcesses })
}

function startGlobalProcessPolling() {
  if (globalProcessPollingId) return
  globalProcessPollingId = setInterval(scanAndEmitAllProcesses, 3000)
}

function stopGlobalProcessPolling() {
  if (globalProcessPollingId && sessions.size === 0) {
    clearInterval(globalProcessPollingId)
    globalProcessPollingId = null
  }
}

export async function detectGitBranch(
  terminalId: number,
  options?: { skipPRRefresh?: boolean },
) {
  try {
    const terminal = getTerminalById(terminalId)
    if (!terminal) return

    let branch: string | null = null

    if (terminal.ssh_host) {
      const result = await execSSHCommand(
        terminal.ssh_host,
        'git rev-parse --abbrev-ref HEAD',
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
            if (err || !stdout) return resolve(null)
            resolve(stdout.trim() || null)
          },
        )
      })
    }

    if (branch) {
      updateTerminal(terminalId, { git_branch: branch })
      getIO()?.emit('terminal:updated', { terminalId })
      if (!options?.skipPRRefresh) {
        refreshPRChecks()
      }
    }
  } catch (err) {
    log.error(
      { err },
      `[pty] Failed to detect git branch for terminal ${terminalId}`,
    )
  }
}

export function getSession(terminalId: number): PtySession | undefined {
  return sessions.get(terminalId)
}

export async function createSession(
  terminalId: number,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  onCommandEvent?: (event: CommandEvent) => void,
): Promise<PtySession | null> {
  // Check if session already exists
  const existing = sessions.get(terminalId)
  if (existing) {
    // Clear any pending timeout
    if (existing.timeoutId) {
      clearTimeout(existing.timeoutId)
      existing.timeoutId = null
    }
    return existing
  }

  // Get terminal from database
  const terminal = getTerminalById(terminalId)
  if (!terminal) {
    log.error(`[pty] Terminal not found: ${terminalId}`)
    return null
  }

  let backend: TerminalBackend

  if (terminal.ssh_host) {
    // --- SSH terminal ---
    const result = validateSSHHost(terminal.ssh_host)
    if (!result.valid) {
      log.error(`[pty] SSH validation failed: ${result.error}`)
      return null
    }

    log.info(
      `[pty] Connecting via SSH: ${terminal.ssh_host} → ${result.config.hostname}`,
    )

    try {
      backend = await createSSHSession(result.config, cols, rows)
    } catch (err) {
      log.error({ err }, '[pty] Failed to create SSH session')
      return null
    }
  } else {
    // --- Local terminal ---
    // Validate cwd exists
    if (!fs.existsSync(terminal.cwd)) {
      log.error(`[pty] Working directory does not exist: ${terminal.cwd}`)
      return null
    }

    // Get shell - use terminal's shell, default from settings, or fallback to SHELL env
    const settings = getSettings()
    let shell = terminal.shell || settings.default_shell

    // Fallback to environment shell if specified shell doesn't exist
    if (!fs.existsSync(shell)) {
      const envShell = process.env.SHELL
      if (envShell && fs.existsSync(envShell)) {
        log.warn(`[pty] Shell ${shell} not found, falling back to ${envShell}`)
        shell = envShell
      } else {
        // Last resort fallback
        const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh']
        const found = fallbacks.find((s) => fs.existsSync(s))
        if (found) {
          log.warn(`[pty] Shell ${shell} not found, falling back to ${found}`)
          shell = found
        } else {
          log.error('[pty] No valid shell found')
          return null
        }
      }
    }

    log.info(`[pty] Spawning shell: ${shell} in ${terminal.cwd}`)

    try {
      backend = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: terminal.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          CLAUDE_TERMINAL_ID: String(terminalId),
        } as Record<string, string>,
      })
    } catch (err) {
      log.error({ err }, '[pty] Failed to spawn shell')
      return null
    }
  }

  const session: PtySession = {
    pty: backend,
    buffer: [],
    timeoutId: null,
    terminalId,
    cols,
    rows,
    onData,
    onExit,
    onCommandEvent: onCommandEvent || null,
    currentCommand: null,
    isIdle: true,
    lastActiveProcesses: '',
  }

  // Create OSC parser to intercept command events
  const oscParser = createOscParser(
    (data) => {
      // Add to buffer
      session.buffer.push(data)
      // Trim buffer if too large
      if (session.buffer.length > MAX_BUFFER_LINES) {
        session.buffer = session.buffer.slice(-MAX_BUFFER_LINES)
      }
      // Call current callback (may have been updated on reconnect)
      session.onData?.(data)
    },
    (event) => {
      // Update session state and database
      switch (event.type) {
        case 'prompt':
          session.isIdle = true
          session.currentCommand = null
          updateTerminal(terminalId, { active_cmd: null })
          log.info(`[pty:${terminalId}] Shell idle (waiting for input)`)
          break
        case 'command_start':
          session.isIdle = false
          session.currentCommand = event.command || null
          updateTerminal(terminalId, { active_cmd: event.command || null })
          log.info(`[pty:${terminalId}] Command started: ${event.command}`)
          // Scan for new processes after a brief delay
          setTimeout(() => scanAndEmitProcessesForTerminal(terminalId), 200)
          break
        case 'command_end':
          log.info(
            `[pty:${terminalId}] Command finished (exit code: ${event.exitCode})`,
          )
          detectGitBranch(terminalId)
          // Scan for process changes after a brief delay
          setTimeout(() => scanAndEmitProcessesForTerminal(terminalId), 200)
          break
      }
      // Forward event to callback
      session.onCommandEvent?.(event)
    },
  )

  // Handle PTY data through OSC parser
  backend.onData((data) => {
    oscParser(data)
  })

  // Handle PTY exit
  backend.onExit(({ exitCode }) => {
    sessions.delete(terminalId)
    stopGlobalProcessPolling()
    updateTerminal(terminalId, {
      pid: null,
      status: 'stopped',
      active_cmd: null,
    })
    session.onExit?.(exitCode)
  })

  // Update terminal with PID (SSH sessions have no local PID)
  updateTerminal(terminalId, {
    pid: backend.pid || null,
    status: 'running',
  })

  sessions.set(terminalId, session)

  // Start global process polling if not already running
  startGlobalProcessPolling()

  if (terminal.ssh_host) {
    // Inject shell integration for SSH terminals inline via heredoc
    try {
      const inlineScript = fs.readFileSync(
        path.join(__dirname, 'shell-integration', 'ssh-inline.sh'),
        'utf-8',
      )
      setTimeout(() => {
        // Use heredoc + eval so the script is interpreted with real newlines
        const injection = `eval "$(cat <<'__SHELL_INTEGRATION_EOF__'\n${inlineScript}\n__SHELL_INTEGRATION_EOF__\n)"\n`
        backend.write(injection)
        if (terminal.cwd && terminal.cwd !== '~') {
          backend.write(`cd ${terminal.cwd}\n`)
        }
        backend.write("printf '\\033c\\x1b[1;1H'\n")
        backend.write('clear\n')
      }, 200)
    } catch (err) {
      log.error({ err }, '[pty] Failed to inject SSH shell integration')
      // Still cd into cwd even if integration fails
      if (terminal.cwd && terminal.cwd !== '~') {
        setTimeout(() => {
          backend.write(`cd ${terminal.cwd}\n`)
        }, 200)
      }
    }
  } else {
    // Inject shell integration for local terminals via source
    const shell = terminal.shell || getSettings().default_shell || '/bin/bash'
    setTimeout(() => {
      const shellName = path.basename(shell)
      let integrationScript: string | null = null

      if (shellName === 'zsh') {
        integrationScript = path.join(__dirname, 'shell-integration', 'zsh.sh')
      } else if (shellName === 'bash') {
        integrationScript = path.join(__dirname, 'shell-integration', 'bash.sh')
      }

      if (integrationScript && fs.existsSync(integrationScript)) {
        // Source the integration silently, then reset and position cursor at top
        backend.write(
          `source "${integrationScript}"; printf '\\033c\\x1b[1;1H'\n`,
        )
        backend.write('clear\n')
      }
    }, 100)
  }

  // Detect git branch and track terminal for GitHub PR checks (local + SSH)
  detectGitBranch(terminalId)
  trackTerminal(terminalId).then(() => startChecksPolling())

  return session
}

export function writeToSession(terminalId: number, data: string): boolean {
  const session = sessions.get(terminalId)
  if (!session) {
    return false
  }
  session.pty.write(data)
  return true
}

export function resizeSession(
  terminalId: number,
  cols: number,
  rows: number,
): boolean {
  const session = sessions.get(terminalId)
  if (!session) {
    return false
  }
  session.cols = cols
  session.rows = rows
  session.pty.resize(cols, rows)
  return true
}

export function getSessionBuffer(terminalId: number): string[] {
  const session = sessions.get(terminalId)
  if (!session) {
    return []
  }
  return [...session.buffer]
}

export function startSessionTimeout(terminalId: number): void {
  const session = sessions.get(terminalId)
  if (!session) {
    return
  }

  // Clear any existing timeout
  if (session.timeoutId) {
    clearTimeout(session.timeoutId)
  }

  // Start new timeout
  session.timeoutId = setTimeout(() => {
    destroySession(terminalId)
  }, SESSION_TIMEOUT_MS)
}

export function clearSessionTimeout(terminalId: number): void {
  const session = sessions.get(terminalId)
  if (!session) {
    return
  }

  if (session.timeoutId) {
    clearTimeout(session.timeoutId)
    session.timeoutId = null
  }
}

export function destroySession(terminalId: number): boolean {
  const session = sessions.get(terminalId)
  if (!session) {
    return false
  }

  // Clear timeout
  if (session.timeoutId) {
    clearTimeout(session.timeoutId)
  }

  // Kill PTY process and all child processes
  try {
    const pid = session.pty.pid
    // Kill the entire process group (negative PID kills the group)
    // This ensures child processes (servers, etc.) are also killed
    // Guard: pid must be > 0 (SSH sessions have pid=0, which would kill our own process group)
    if (pid && pid > 0) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // Process group may not exist, try killing just the process
      }
      // Give processes a moment to clean up, then force kill
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // Already dead
        }
      }, 100)
    }
    session.pty.kill('SIGKILL')
  } catch {
    // Process may already be dead
  }

  // Update database
  updateTerminal(terminalId, { pid: null, status: 'stopped', active_cmd: null })

  sessions.delete(terminalId)
  stopGlobalProcessPolling()
  untrackTerminal(terminalId)
  return true
}

export function hasActiveSession(terminalId: number): boolean {
  return sessions.has(terminalId)
}

// Update callbacks when a new WebSocket connects to an existing session
export function attachSession(
  terminalId: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  onCommandEvent?: (event: CommandEvent) => void,
): boolean {
  const session = sessions.get(terminalId)
  if (!session) {
    return false
  }
  session.onData = onData
  session.onExit = onExit
  if (onCommandEvent) {
    session.onCommandEvent = onCommandEvent
  }
  return true
}
