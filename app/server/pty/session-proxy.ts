/**
 * Session Proxy (master-side)
 *
 * Manages worker processes and provides the same public API as the old
 * direct-session manager. Each shell PTY runs in its own child process
 * via child_process.fork().
 */
import { type ChildProcess, fork } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Shell } from '../../src/types'
import {
  getSettings,
  getShellById,
  getTerminalById,
  updateTerminal,
} from '../db'
import { startChecksPolling, trackTerminal } from '../github/checks'
import { getIO } from '../io'
import { log } from '../logger'
import { validateSSHHost } from '../ssh/config'
import type { WorkerInitConfig, WorkerToMasterMessage } from './ipc-types'
import type { CommandEvent } from './osc-parser'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = path.join(__dirname, 'worker.ts')

const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const LONG_TIMEOUT = 900_000 // 15 min for setup/teardown operations

const WORKIO_INTEGRATION_DIR = path.join(
  os.homedir(),
  '.workio',
  'shell-integration',
)

// ── Worker handle ───────────────────────────────────────────────────

export interface WorkerHandle {
  shellId: number
  terminalId: number
  process: ChildProcess
  ready: boolean
  ptyPid: number
  // Callbacks registered by terminal.ts
  onData: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
  onCommandEvent: ((event: CommandEvent) => void) | null
  // Cached state from worker
  isIdle: boolean
  currentCommand: string | null
  sessionName: string
  shell: Shell
  cols: number
  rows: number
  // Timeout management
  timeoutId: NodeJS.Timeout | null
  // Promise tracking
  onDoneMarker: ((exitCode: number) => void) | null
  // Pending IPC responses
  pendingBufferRequests: Map<string, (buffer: string[]) => void>
  pendingKillChildrenRequests: Map<string, (success: boolean) => void>
}

const workers = new Map<number, WorkerHandle>()

// ── Public API  ─────────────────────────────────────────────────────
// These exports match the signatures from the old manager.ts

/**
 * Called by manager.ts when a worker sends a command-event.
 * The actual handler logic lives in manager.ts (handleWorkerCommandEvent).
 */
export type CommandEventHandler = (
  terminalId: number,
  shellId: number,
  event: CommandEvent,
  handle: WorkerHandle,
) => void

let commandEventHandler: CommandEventHandler | null = null

export function setCommandEventHandler(handler: CommandEventHandler) {
  commandEventHandler = handler
}

/** Lightweight object that mimics PtySession shape for consumers */
export interface SessionProxy {
  shell: Shell
  terminalId: number
  sessionName: string
  cols: number
  rows: number
  isIdle: boolean
  currentCommand: string | null
  pty: { pid: number }
  onData: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
  onCommandEvent: ((event: CommandEvent) => void) | null
  onDoneMarker: ((exitCode: number) => void) | null
}

function toSessionProxy(h: WorkerHandle): SessionProxy {
  return {
    shell: h.shell,
    terminalId: h.terminalId,
    sessionName: h.sessionName,
    cols: h.cols,
    rows: h.rows,
    isIdle: h.isIdle,
    currentCommand: h.currentCommand,
    pty: { pid: h.ptyPid },
    onData: h.onData,
    onExit: h.onExit,
    onCommandEvent: h.onCommandEvent,
    onDoneMarker: h.onDoneMarker,
  }
}

// ── Fork helper ─────────────────────────────────────────────────────

function forkWorker(shellId: number): ChildProcess {
  const child = fork(WORKER_PATH, [], {
    serialization: 'advanced',
    execArgv: ['--import', 'tsx'],
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
  // Capture worker stdout/stderr in master logger
  child.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.info(`[worker:${shellId}] ${msg}`)
  })
  child.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.error(`[worker:${shellId}] ${msg}`)
  })
  return child
}

// ── Worker message handler ──────────────────────────────────────────

function handleWorkerMessage(handle: WorkerHandle, msg: WorkerToMasterMessage) {
  switch (msg.type) {
    case 'ready':
      handle.ready = true
      handle.ptyPid = msg.pid
      break

    case 'data':
      handle.onData?.(msg.data)
      break

    case 'exit':
      handle.onExit?.(msg.code)
      updateTerminal(handle.terminalId, {
        pid: null,
        status: 'stopped',
      }).catch((err) =>
        log.error(
          { err },
          `[proxy] Failed to update terminal ${handle.terminalId} on exit`,
        ),
      )
      workers.delete(handle.shellId)
      break

    case 'command-event':
      // Resolve done_marker promise (used by waitForMarker)
      if (msg.event.type === 'done_marker' && handle.onDoneMarker) {
        const cb = handle.onDoneMarker
        handle.onDoneMarker = null
        cb(msg.event.exitCode ?? 0)
      }
      handle.onCommandEvent?.(msg.event)
      // Forward to the master's handler for git polling, bell notifications, etc.
      commandEventHandler?.(
        handle.terminalId,
        handle.shellId,
        msg.event,
        handle,
      )
      break

    case 'bell':
      // Forward bell to Socket.IO clients
      getIO()?.emit('pty:bell', {
        shellId: msg.shellId,
        terminalId: msg.terminalId,
      })
      break

    case 'state-update':
      handle.isIdle = msg.isIdle
      handle.currentCommand = msg.currentCommand
      break

    case 'buffer-response': {
      const resolve = handle.pendingBufferRequests.get(msg.requestId)
      if (resolve) {
        handle.pendingBufferRequests.delete(msg.requestId)
        resolve(msg.buffer)
      }
      break
    }

    case 'kill-children-response': {
      const resolve = handle.pendingKillChildrenRequests.get(msg.requestId)
      if (resolve) {
        handle.pendingKillChildrenRequests.delete(msg.requestId)
        resolve(msg.success)
      }
      break
    }

    case 'log':
      if (msg.level === 'error') {
        log.error(msg.data ?? {}, msg.message)
      } else if (msg.level === 'warn') {
        log.warn(msg.message)
      } else {
        log.info(msg.message)
      }
      break

    case 'error':
      log.error(`[worker:${handle.shellId}] ${msg.message}`)
      break
  }
}

// ── createSession ───────────────────────────────────────────────────

export async function createSession(
  shellId: number,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  onCommandEvent?: (event: CommandEvent) => void,
): Promise<SessionProxy | null> {
  // Check if session already exists
  const existing = workers.get(shellId)
  if (existing) {
    if (existing.timeoutId) {
      clearTimeout(existing.timeoutId)
      existing.timeoutId = null
    }
    return toSessionProxy(existing)
  }

  // Get shell from database
  const shellRecord = await getShellById(shellId)
  if (!shellRecord) {
    log.error(`[proxy] Shell not found: ${shellId}`)
    return null
  }

  const terminalId = shellRecord.terminal_id
  const terminal = await getTerminalById(terminalId)
  if (!terminal) {
    log.error(`[proxy] Terminal not found: ${terminalId}`)
    return null
  }

  const terminalName = terminal.name || `terminal-${terminalId}`
  const sessionName =
    shellRecord.name === 'main'
      ? terminalName
      : `${terminalName}-${shellRecord.name}`

  // Build init config
  const config: WorkerInitConfig = {
    shellId,
    terminalId,
    cols,
    rows,
    sessionName,
    shellName: shellRecord.name,
  }

  if (terminal.ssh_host) {
    // SSH terminal
    const result = validateSSHHost(terminal.ssh_host)
    if (!result.valid) {
      log.error(`[proxy] SSH validation failed: ${result.error}`)
      return null
    }

    config.sshHost = terminal.ssh_host
    config.sshConfig = {
      host: result.config.host,
      hostname: result.config.hostname,
      port: result.config.port,
      user: result.config.user,
      identityFile: result.config.identityFile,
    }
    config.cwd = terminal.cwd

    // Read SSH inline script
    const sshScriptPath = path.join(WORKIO_INTEGRATION_DIR, 'ssh-inline.sh')
    try {
      config.sshInlineScript = await fs.promises.readFile(
        sshScriptPath,
        'utf-8',
      )
    } catch (err) {
      log.error({ err }, '[proxy] Failed to read SSH shell integration')
    }
  } else {
    // Local terminal
    try {
      await fs.promises.access(terminal.cwd)
    } catch {
      log.error(`[proxy] Working directory does not exist: ${terminal.cwd}`)
      return null
    }

    const settings = await getSettings()
    let shell = terminal.shell || settings.default_shell

    const exists = async (p: string) => {
      try {
        await fs.promises.access(p)
        return true
      } catch {
        return false
      }
    }

    if (!(await exists(shell))) {
      const envShell = process.env.SHELL
      if (envShell && (await exists(envShell))) {
        log.warn(
          `[proxy] Shell ${shell} not found, falling back to ${envShell}`,
        )
        shell = envShell
      } else {
        const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh']
        let found: string | undefined
        for (const s of fallbacks) {
          if (await exists(s)) {
            found = s
            break
          }
        }
        if (found) {
          log.warn(`[proxy] Shell ${shell} not found, falling back to ${found}`)
          shell = found
        } else {
          log.error('[proxy] No valid shell found')
          return null
        }
      }
    }

    config.cwd = terminal.cwd
    config.shell = shell
    config.env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      WORKIO_TERMINAL_ID: String(terminalId),
      WORKIO_SHELL_ID: String(shellId),
    } as Record<string, string>

    // Determine shell integration script
    const shellName = path.basename(shell)
    let integrationScript: string | null = null
    if (shellName === 'zsh') {
      integrationScript = path.join(WORKIO_INTEGRATION_DIR, 'zsh.sh')
    } else if (shellName === 'bash') {
      integrationScript = path.join(WORKIO_INTEGRATION_DIR, 'bash.sh')
    }

    if (integrationScript) {
      try {
        await fs.promises.access(integrationScript)
        config.integrationScript = integrationScript
      } catch {
        // Script doesn't exist
      }
    }
  }

  // Fork worker
  const child = forkWorker(shellId)

  const handle: WorkerHandle = {
    shellId,
    terminalId,
    process: child,
    ready: false,
    ptyPid: 0,
    onData,
    onExit,
    onCommandEvent: onCommandEvent || null,
    isIdle: true,
    currentCommand: null,
    sessionName,
    shell: shellRecord,
    cols,
    rows,
    timeoutId: null,
    onDoneMarker: null,
    pendingBufferRequests: new Map(),
    pendingKillChildrenRequests: new Map(),
  }

  workers.set(shellId, handle)

  // Handle worker messages
  child.on('message', (msg: WorkerToMasterMessage) => {
    handleWorkerMessage(handle, msg)
  })

  // Handle worker crash
  child.on('exit', (code, signal) => {
    if (workers.has(shellId)) {
      log.warn(
        `[proxy] Worker for shell ${shellId} exited unexpectedly (code=${code}, signal=${signal})`,
      )
      handle.onExit?.(code ?? 1)
      updateTerminal(terminalId, { pid: null, status: 'stopped' }).catch(
        (err) =>
          log.error(
            { err },
            `[proxy] Failed to update terminal ${terminalId} on worker crash`,
          ),
      )
      workers.delete(shellId)
    }
  })

  // Send init message
  child.send({ type: 'init', config })

  // Wait for ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Worker for shell ${shellId} timed out on init`))
    }, 30_000)

    const checkReady = () => {
      if (handle.ready) {
        clearTimeout(timeout)
        resolve()
        return
      }
      setTimeout(checkReady, 50)
    }
    checkReady()
  })

  // Update terminal with PID
  await updateTerminal(terminalId, {
    pid: handle.ptyPid || null,
    status: 'running',
  })

  log.info(
    `[proxy] Session created: shell=${shellId}, terminal=${terminalId}, workerPid=${child.pid}, ptyPid=${handle.ptyPid}`,
  )

  // Write terminal/shell name files for dynamic zellij session naming (fire-and-forget)
  const {
    writeTerminalNameFile,
    writeShellNameFile,
    detectGitBranch,
    flushPendingCommand,
  } = await import('./manager')
  writeTerminalNameFile(terminalId, terminalName)
  writeShellNameFile(shellId, shellRecord.name)

  // Flush any pending command queued before the worker was ready
  const pending = flushPendingCommand(shellId)
  if (pending) {
    child.send({ type: 'set-pending-command', command: pending })
  }

  // Detect git branch and track for PR checks (fire-and-forget, handled by manager)
  detectGitBranch(terminalId)
  trackTerminal(terminalId).then(() => startChecksPolling())

  return toSessionProxy(handle)
}

// ── writeToSession ──────────────────────────────────────────────────

export function writeToSession(shellId: number, data: string): boolean {
  const handle = workers.get(shellId)
  if (!handle) return false
  handle.process.send({ type: 'write', data })
  return true
}

// ── resizeSession ───────────────────────────────────────────────────

export function resizeSession(
  shellId: number,
  cols: number,
  rows: number,
): boolean {
  const handle = workers.get(shellId)
  if (!handle) return false
  handle.cols = cols
  handle.rows = rows
  handle.process.send({ type: 'resize', cols, rows })
  return true
}

// ── getSession ──────────────────────────────────────────────────────

export function getSession(shellId: number): SessionProxy | undefined {
  const handle = workers.get(shellId)
  if (!handle) return undefined
  return toSessionProxy(handle)
}

// ── getSessionByTerminalId ──────────────────────────────────────────

export function getSessionByTerminalId(
  terminalId: number,
): SessionProxy | undefined {
  // Prefer "main" shell, fallback to any
  for (const handle of workers.values()) {
    if (handle.terminalId === terminalId && handle.shell.name === 'main') {
      return toSessionProxy(handle)
    }
  }
  for (const handle of workers.values()) {
    if (handle.terminalId === terminalId) {
      return toSessionProxy(handle)
    }
  }
  return undefined
}

// ── getSessionBuffer (async – IPC round-trip) ───────────────────────

export async function getSessionBuffer(shellId: number): Promise<string[]> {
  const handle = workers.get(shellId)
  if (!handle) return []

  const requestId = crypto.randomUUID()
  return new Promise<string[]>((resolve) => {
    const timeout = setTimeout(() => {
      handle.pendingBufferRequests.delete(requestId)
      resolve([])
    }, 5000)

    handle.pendingBufferRequests.set(requestId, (buf) => {
      clearTimeout(timeout)
      resolve(buf)
    })

    handle.process.send({ type: 'get-buffer', requestId })
  })
}

// ── destroySession ──────────────────────────────────────────────────

export function destroySession(shellId: number): boolean {
  const handle = workers.get(shellId)
  if (!handle) return false

  if (handle.timeoutId) {
    clearTimeout(handle.timeoutId)
    handle.timeoutId = null
  }

  handle.process.send({ type: 'kill' })

  // Force kill after 2s if worker doesn't exit
  setTimeout(() => {
    try {
      handle.process.kill('SIGKILL')
    } catch {
      // Already dead
    }
  }, 2000)

  workers.delete(shellId)

  updateTerminal(handle.terminalId, {
    pid: null,
    status: 'stopped',
  }).catch((err) =>
    log.error(
      { err },
      `[proxy] Failed to update terminal ${handle.terminalId} on destroy`,
    ),
  )

  return true
}

// ── destroySessionsForTerminal ──────────────────────────────────────

export function destroySessionsForTerminal(terminalId: number): boolean {
  const terminalHandles: WorkerHandle[] = []
  for (const handle of workers.values()) {
    if (handle.terminalId === terminalId) {
      terminalHandles.push(handle)
    }
  }
  if (terminalHandles.length === 0) return false

  for (const handle of terminalHandles) {
    if (handle.timeoutId) {
      clearTimeout(handle.timeoutId)
      handle.timeoutId = null
    }
    handle.process.send({ type: 'kill' })
    setTimeout(() => {
      try {
        handle.process.kill('SIGKILL')
      } catch {
        // Already dead
      }
    }, 2000)
    workers.delete(handle.shellId)
  }

  updateTerminal(terminalId, {
    pid: null,
    status: 'stopped',
  }).catch((err) =>
    log.error(
      { err },
      `[proxy] Failed to update terminal ${terminalId} on destroy`,
    ),
  )

  return true
}

// ── destroyAllSessions (graceful shutdown) ──────────────────────────

export function destroyAllSessions(): void {
  for (const handle of workers.values()) {
    if (handle.timeoutId) {
      clearTimeout(handle.timeoutId)
    }
    try {
      handle.process.send({ type: 'kill' })
    } catch {
      // IPC channel may already be closed
    }
    setTimeout(() => {
      try {
        handle.process.kill('SIGKILL')
      } catch {
        // Already dead
      }
    }, 2000)
  }
  workers.clear()
}

// ── hasActiveSession ────────────────────────────────────────────────

export function hasActiveSession(shellId: number): boolean {
  return workers.has(shellId)
}

export function hasActiveSessionForTerminal(terminalId: number): boolean {
  for (const handle of workers.values()) {
    if (handle.terminalId === terminalId) return true
  }
  return false
}

// ── attachSession ───────────────────────────────────────────────────

export function attachSession(
  shellId: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  onCommandEvent?: (event: CommandEvent) => void,
): boolean {
  const handle = workers.get(shellId)
  if (!handle) return false
  handle.onData = onData
  handle.onExit = onExit
  if (onCommandEvent) {
    handle.onCommandEvent = onCommandEvent
  }
  return true
}

// ── Timeout management ──────────────────────────────────────────────

export function startSessionTimeout(shellId: number): void {
  const handle = workers.get(shellId)
  if (!handle) return

  if (handle.timeoutId) {
    clearTimeout(handle.timeoutId)
  }

  handle.timeoutId = setTimeout(() => {
    destroySession(shellId)
  }, SESSION_TIMEOUT_MS)
}

export function clearSessionTimeout(shellId: number): void {
  const handle = workers.get(shellId)
  if (!handle) return

  if (handle.timeoutId) {
    clearTimeout(handle.timeoutId)
    handle.timeoutId = null
  }
}

// ── waitForMarker ───────────────────────────────────────────────────

export function waitForMarker(shellId: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const handle = workers.get(shellId)
    if (!handle) {
      resolve(0)
      return
    }
    const timeout = setTimeout(() => {
      handle.onDoneMarker = null
      reject(new Error(`waitForMarker timed out for shell ${shellId}`))
    }, LONG_TIMEOUT)
    handle.onDoneMarker = (exitCode: number) => {
      clearTimeout(timeout)
      resolve(exitCode)
    }
  })
}

// ── waitForSession ──────────────────────────────────────────────────

export function waitForSession(
  shellId: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (workers.has(shellId)) {
      resolve(true)
      return
    }
    const start = Date.now()
    const interval = setInterval(() => {
      if (workers.has(shellId)) {
        clearInterval(interval)
        resolve(true)
        return
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(interval)
        resolve(false)
      }
    }, 500)
  })
}

// ── cancelWaitForMarker ─────────────────────────────────────────────

export function cancelWaitForMarker(shellId: number): void {
  const handle = workers.get(shellId)
  if (handle?.onDoneMarker) {
    const cb = handle.onDoneMarker
    handle.onDoneMarker = null
    cb(0)
  }
}

// ── interruptSession ────────────────────────────────────────────────

export function interruptSession(shellId: number): void {
  const handle = workers.get(shellId)
  if (handle) {
    handle.process.send({ type: 'interrupt' })
  }
}

// ── killShellChildren ───────────────────────────────────────────────

export async function killShellChildren(shellId: number): Promise<boolean> {
  const handle = workers.get(shellId)
  if (!handle) return false

  const requestId = crypto.randomUUID()
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      handle.pendingKillChildrenRequests.delete(requestId)
      resolve(false)
    }, 5000)

    handle.pendingKillChildrenRequests.set(requestId, (success) => {
      clearTimeout(timeout)
      resolve(success)
    })

    handle.process.send({ type: 'kill-children', requestId })
  })
}

// ── setPendingCommand ───────────────────────────────────────────────

export function setPendingCommand(shellId: number, command: string): void {
  const handle = workers.get(shellId)
  if (handle) {
    handle.process.send({ type: 'set-pending-command', command })
  } else {
    // Session doesn't exist yet — store locally so createSession can
    // send it after the worker is ready. We use the pendingCommands map
    // in manager.ts for this.
  }
}

// ── updateSessionName ───────────────────────────────────────────────

export function updateSessionName(
  shellId: number,
  newSessionName: string,
): void {
  const handle = workers.get(shellId)
  if (handle) {
    handle.sessionName = newSessionName
    handle.process.send({ type: 'update-session-name', name: newSessionName })
  }
}

// ── Internal helpers for manager.ts ─────────────────────────────────

export function getWorkersForTerminal(terminalId: number): WorkerHandle[] {
  const result: WorkerHandle[] = []
  for (const handle of workers.values()) {
    if (handle.terminalId === terminalId) result.push(handle)
  }
  return result
}

export function getAllWorkers(): Map<number, WorkerHandle> {
  return workers
}

export function getWorker(shellId: number): WorkerHandle | undefined {
  return workers.get(shellId)
}
