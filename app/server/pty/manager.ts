import fs from 'node:fs'
import type { IPty } from 'node-pty'
import * as pty from 'node-pty'
import { getSettings, getTerminalById, updateTerminal } from '../db'

const MAX_BUFFER_LINES = 5000
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export interface PtySession {
  pty: IPty
  buffer: string[]
  timeoutId: NodeJS.Timeout | null
  terminalId: number
  cols: number
  rows: number
  onData: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
}

// In-memory map of active PTY sessions
const sessions = new Map<number, PtySession>()

export function getSession(terminalId: number): PtySession | undefined {
  return sessions.get(terminalId)
}

export function createSession(
  terminalId: number,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
): PtySession | null {
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
    console.error('[pty] Terminal not found:', terminalId)
    return null
  }

  // Validate cwd exists
  if (!fs.existsSync(terminal.cwd)) {
    console.error('[pty] Working directory does not exist:', terminal.cwd)
    return null
  }

  // Get shell - use terminal's shell, default from settings, or fallback to SHELL env
  const settings = getSettings()
  let shell = terminal.shell || settings.default_shell

  // Fallback to environment shell if specified shell doesn't exist
  if (!fs.existsSync(shell)) {
    const envShell = process.env.SHELL
    if (envShell && fs.existsSync(envShell)) {
      console.warn(
        `[pty] Shell ${shell} not found, falling back to ${envShell}`,
      )
      shell = envShell
    } else {
      // Last resort fallback
      const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh']
      const found = fallbacks.find((s) => fs.existsSync(s))
      if (found) {
        console.warn(`[pty] Shell ${shell} not found, falling back to ${found}`)
        shell = found
      } else {
        console.error('[pty] No valid shell found')
        return null
      }
    }
  }

  console.log('[pty] Spawning shell:', shell, 'in', terminal.cwd)

  // Spawn PTY process
  let ptyProcess: IPty
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: terminal.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })
  } catch (err) {
    console.error('[pty] Failed to spawn shell:', err)
    return null
  }

  const session: PtySession = {
    pty: ptyProcess,
    buffer: [],
    timeoutId: null,
    terminalId,
    cols,
    rows,
    onData,
    onExit,
  }

  // Handle PTY data - use session.onData so it can be updated on reconnect
  ptyProcess.onData((data) => {
    // Add to buffer
    session.buffer.push(data)
    // Trim buffer if too large
    if (session.buffer.length > MAX_BUFFER_LINES) {
      session.buffer = session.buffer.slice(-MAX_BUFFER_LINES)
    }
    // Call current callback (may have been updated on reconnect)
    session.onData?.(data)
  })

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(terminalId)
    updateTerminal(terminalId, { pid: null, status: 'stopped' })
    session.onExit?.(exitCode)
  })

  // Update terminal with PID
  updateTerminal(terminalId, { pid: ptyProcess.pid, status: 'running' })

  sessions.set(terminalId, session)
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
    if (pid) {
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
  updateTerminal(terminalId, { pid: null, status: 'stopped' })

  sessions.delete(terminalId)
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
): boolean {
  const session = sessions.get(terminalId)
  if (!session) {
    return false
  }
  session.onData = onData
  session.onExit = onExit
  return true
}
