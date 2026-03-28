/**
 * PTY Session Domain
 *
 * PtySession class owns per-shell state: worker process, IPC, callbacks,
 * timeout, pending command, bell subscription, naming.
 *
 * Module-level sessions Map<shellId, PtySession> replaces the scattered
 * Maps from the old session-proxy.ts + manager.ts.
 */
import { type ChildProcess, execFile, fork } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNotification } from '@domains/notifications/registry'
import { sendPushNotification } from '@domains/notifications/service'
import {
  type BellSubscription,
  type CommandEvent,
  type WorkerInitConfig,
  type WorkerToMasterMessage,
  workerToMasterMessageSchema,
} from '@domains/pty/schema'
import { getSettings } from '@domains/settings/db'
import { getServerConfig } from '@domains/settings/server-config'
import { getShellById } from '@domains/workspace/db/shells'
import {
  getTerminalById,
  updateTerminal,
} from '@domains/workspace/db/terminals'
import type { Shell } from '@domains/workspace/schema/shells'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { sanitizeName, shellEscape } from '@server/lib/strings'
import { log } from '@server/logger'
import { bootstrapRemoteHost } from '@server/ssh/claude-forwarding'
import { validateSSHHost } from '@server/ssh/config'
import { execSSHCommandLogged } from '@server/ssh/exec'
import { poolExecSSHCommand } from '@server/ssh/pool'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = path.join(__dirname, 'services', 'worker.ts')

const LONG_TIMEOUT = 900_000 // 15 min for setup/teardown operations

const WORKIO_DIR = path.join(os.homedir(), '.workio')
const WORKIO_INTEGRATION_DIR = path.join(WORKIO_DIR, 'shell-integration')
const WORKIO_TERMINALS_DIR = path.join(WORKIO_DIR, 'terminals')
const WORKIO_SHELLS_DIR = path.join(WORKIO_DIR, 'shells')

// ── PtySession class ────────────────────────────────────────────────

export class PtySession {
  readonly shellId: number
  readonly terminalId: number
  readonly process: ChildProcess
  readonly shell: Shell
  sshHost: string | null

  ready = false
  ptyPid = 0
  remotePid = 0

  onData: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
  onCommandEvent: ((event: CommandEvent) => void) | null
  onDoneMarker: ((exitCode: number) => void) | null = null

  isIdle = true
  currentCommand: string | null = null
  staleScanCount = 0
  sessionName: string
  cols: number
  rows: number

  timeoutId: NodeJS.Timeout | null = null
  bellSubscription: BellSubscription | null = null

  readonly pendingBufferRequests = new Map<string, (buffer: string[]) => void>()
  readonly pendingKillChildrenRequests = new Map<
    string,
    (success: boolean) => void
  >()

  constructor(
    shellId: number,
    terminalId: number,
    process: ChildProcess,
    shell: Shell,
    sessionName: string,
    cols: number,
    rows: number,
    sshHost: string | null,
    onData: (data: string) => void,
    onExit: (code: number) => void,
    onCommandEvent?: (event: CommandEvent) => void,
  ) {
    this.shellId = shellId
    this.terminalId = terminalId
    this.process = process
    this.shell = shell
    this.sessionName = sessionName
    this.cols = cols
    this.rows = rows
    this.sshHost = sshHost
    this.onData = onData
    this.onExit = onExit
    this.onCommandEvent = onCommandEvent || null
  }

  // ── IPC ──────────────────────────────────────────────────────────

  write(data: string) {
    this.process.send({ type: 'write', data })
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.process.send({ type: 'resize', cols, rows })
  }

  interrupt() {
    this.process.send({ type: 'interrupt' })
  }

  async killChildren() {
    const requestId = crypto.randomUUID()
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingKillChildrenRequests.delete(requestId)
        resolve(false)
      }, 5000)

      this.pendingKillChildrenRequests.set(requestId, (success) => {
        clearTimeout(timeout)
        resolve(success)
      })

      this.process.send({ type: 'kill-children', requestId })
    })
  }

  async getBuffer() {
    const requestId = crypto.randomUUID()
    return new Promise<string[]>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingBufferRequests.delete(requestId)
        resolve([])
      }, 5000)

      this.pendingBufferRequests.set(requestId, (buf) => {
        clearTimeout(timeout)
        resolve(buf)
      })

      this.process.send({ type: 'get-buffer', requestId })
    })
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  destroy() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }

    log.info(`[pty] shell=${this.shellId} destroying session`)
    try {
      this.process.send({ type: 'kill' })
    } catch {
      // IPC channel may already be closed
    }

    // Force kill after 2s if worker doesn't exit
    setTimeout(() => {
      try {
        this.process.kill('SIGKILL')
      } catch {
        // Already dead
      }
    }, 2000)

    sessions.delete(this.shellId)

    updateTerminal(this.terminalId, {
      pid: null,
      status: 'stopped',
    }).catch((err) =>
      log.error(
        { err },
        `[pty] Failed to update terminal ${this.terminalId} on destroy`,
      ),
    )

    serverEvents.emit('pty:session-destroyed', {
      shellId: this.shellId,
      terminalId: this.terminalId,
      sshHost: this.sshHost,
    })
  }

  attach(
    onData: (data: string) => void,
    onExit: (code: number) => void,
    onCommandEvent?: (event: CommandEvent) => void,
  ) {
    this.onData = onData
    this.onExit = onExit
    if (onCommandEvent) {
      this.onCommandEvent = onCommandEvent
    }
  }

  // ── Timeout ──────────────────────────────────────────────────────

  startTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
    this.timeoutId = setTimeout(() => {
      this.destroy()
    }, getServerConfig('session_timeout_ms'))
  }

  clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  // ── Pending command ──────────────────────────────────────────────

  setPendingCommand(command: string) {
    this.process.send({ type: 'set-pending-command', command })
  }

  // ── Bell ─────────────────────────────────────────────────────────

  subscribeBell(sub: BellSubscription) {
    this.bellSubscription = sub
    emitBellSubscriptions()
  }

  unsubscribeBell() {
    this.bellSubscription = null
    emitBellSubscriptions()
  }

  // ── Marker ───────────────────────────────────────────────────────

  waitForMarker() {
    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.onDoneMarker = null
        reject(new Error(`waitForMarker timed out for shell ${this.shellId}`))
      }, LONG_TIMEOUT)
      this.onDoneMarker = (exitCode: number) => {
        clearTimeout(timeout)
        resolve(exitCode)
      }
    })
  }

  cancelWaitForMarker() {
    if (this.onDoneMarker) {
      const cb = this.onDoneMarker
      this.onDoneMarker = null
      cb(0)
    }
  }

  // ── Name ─────────────────────────────────────────────────────────

  updateName(newSessionName: string) {
    this.sessionName = newSessionName
    this.process.send({ type: 'update-session-name', name: newSessionName })
  }
}

// ── Module state ────────────────────────────────────────────────────

const sessions = new Map<number, PtySession>()

// Pending commands for shells that don't have a worker yet
const pendingCommands = new Map<number, string>()

// Forward server config changes to all live workers
serverEvents.on('settings:server-config-changed', (changed) => {
  if ('max_buffer_lines' in changed) {
    for (const session of sessions.values()) {
      session.process.send({
        type: 'update-config',
        max_buffer_lines: changed.max_buffer_lines,
      })
    }
  }
})

// ── Worker message handler ──────────────────────────────────────────

function handleWorkerMessage(session: PtySession, msg: WorkerToMasterMessage) {
  switch (msg.type) {
    case 'ready':
      session.ready = true
      session.ptyPid = msg.pid
      break

    case 'data':
      session.onData?.(msg.data)
      break

    case 'exit':
      session.onExit?.(msg.code)
      updateTerminal(session.terminalId, {
        pid: null,
        status: 'stopped',
      }).catch((err) =>
        log.error(
          { err },
          `[pty] Failed to update terminal ${session.terminalId} on exit`,
        ),
      )
      sessions.delete(session.shellId)
      break

    case 'command-event':
      // Resolve done_marker promise (used by waitForMarker)
      if (msg.event.type === 'done_marker' && session.onDoneMarker) {
        const cb = session.onDoneMarker
        session.onDoneMarker = null
        cb(msg.event.exitCode ?? 0)
      }
      session.onCommandEvent?.(msg.event)
      // Forward to monitor for git polling, bell notifications, etc.
      serverEvents.emit('pty:command-event', {
        terminalId: session.terminalId,
        shellId: session.shellId,
        event: msg.event,
      })
      break

    case 'bell':
      getIO()?.emit('pty:bell', {
        shellId: msg.shellId,
        terminalId: msg.terminalId,
      })
      break

    case 'state-update':
      session.isIdle = msg.isIdle
      session.currentCommand = msg.currentCommand
      break

    case 'buffer-response': {
      const resolve = session.pendingBufferRequests.get(msg.requestId)
      if (resolve) {
        session.pendingBufferRequests.delete(msg.requestId)
        resolve(msg.buffer)
      }
      break
    }

    case 'kill-children-response': {
      const resolve = session.pendingKillChildrenRequests.get(msg.requestId)
      if (resolve) {
        session.pendingKillChildrenRequests.delete(msg.requestId)
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
      log.error(`[worker:${session.shellId}] ${msg.message}`)
      break
  }
}

// ── Fork helper ─────────────────────────────────────────────────────

function forkWorker(shellId: number) {
  const child = fork(WORKER_PATH, [], {
    serialization: 'advanced',
    execArgv: ['--import', 'tsx'],
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
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

// ── Public API ──────────────────────────────────────────────────────

export async function createSession(
  shellId: number,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  onCommandEvent?: (event: CommandEvent) => void,
) {
  // Check if session already exists
  const existing = sessions.get(shellId)
  if (existing) {
    existing.clearTimeout()
    return existing
  }

  // Get shell from database
  const shellRecord = await getShellById(shellId)
  if (!shellRecord) {
    log.error(`[pty] Shell not found: ${shellId}`)
    return null
  }

  const terminalId = shellRecord.terminal_id
  const terminal = await getTerminalById(terminalId)
  if (!terminal) {
    log.error(`[pty] Terminal not found: ${terminalId}`)
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
    max_buffer_lines: getServerConfig('max_buffer_lines'),
  }

  if (terminal.ssh_host) {
    // SSH terminal
    const result = validateSSHHost(terminal.ssh_host)
    if (!result.valid) {
      log.error(`[pty] SSH validation failed: ${result.error}`)
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
      log.error({ err }, '[pty] Failed to read SSH shell integration')
    }
  } else {
    // Local terminal
    try {
      await fs.promises.access(terminal.cwd)
    } catch {
      log.error(`[pty] Working directory does not exist: ${terminal.cwd}`)
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
        log.warn(`[pty] Shell ${shell} not found, falling back to ${envShell}`)
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
          log.warn(`[pty] Shell ${shell} not found, falling back to ${found}`)
          shell = found
        } else {
          log.error('[pty] No valid shell found')
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

  const session = new PtySession(
    shellId,
    terminalId,
    child,
    shellRecord,
    sessionName,
    cols,
    rows,
    terminal.ssh_host || null,
    onData,
    onExit,
    onCommandEvent,
  )

  sessions.set(shellId, session)

  // Handle worker messages
  child.on('message', (raw: unknown) => {
    let msg: WorkerToMasterMessage
    try {
      msg = workerToMasterMessageSchema.parse(raw)
    } catch (err) {
      log.error(
        { err, raw },
        `[pty] Invalid worker→master message for shell=${shellId}`,
      )
      return
    }
    handleWorkerMessage(session, msg)
  })

  // Handle worker crash
  child.on('exit', (code, signal) => {
    if (sessions.has(shellId)) {
      log.warn(
        `[pty] Worker for shell ${shellId} exited unexpectedly (code=${code}, signal=${signal})`,
      )
      session.onExit?.(code ?? 1)
      updateTerminal(terminalId, { pid: null, status: 'stopped' }).catch(
        (err) =>
          log.error(
            { err },
            `[pty] Failed to update terminal ${terminalId} on worker crash`,
          ),
      )
      sessions.delete(shellId)
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
      if (session.ready) {
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
    pid: session.ptyPid || null,
    status: 'running',
  })

  log.info(
    `[pty] Session created: shell=${shellId}, terminal=${terminalId}, workerPid=${child.pid}, ptyPid=${session.ptyPid}`,
  )

  // Write terminal/shell name files for dynamic zellij session naming (fire-and-forget)
  writeTerminalNameFile(terminalId, terminalName)
  writeShellNameFile(shellId, shellRecord.name)

  // Also write name files on the remote host for SSH terminals (fire-and-forget)
  if (terminal.ssh_host) {
    const tn = sanitizeName(terminalName)
    const sn = sanitizeName(shellRecord.name)
    poolExecSSHCommand(
      terminal.ssh_host!,
      `mkdir -p ~/.workio/terminals ~/.workio/shells && printf '%s' ${shellEscape(tn)} > ~/.workio/terminals/${terminalId} && printf '%s' ${shellEscape(sn)} > ~/.workio/shells/${shellId}`,
      { timeout: 5000 },
    ).catch(() => {})

    // Bootstrap Claude hook forwarding for this SSH host (fire-and-forget)
    bootstrapRemoteHost(terminal.ssh_host!).catch(() => {})
  }

  // Flush any pending command queued before the worker was ready
  const pending = flushPendingCommand(shellId)
  if (pending) {
    child.send({ type: 'set-pending-command', command: pending })
  }

  // Notify listeners: git detects branch, workspace runs auto-detect, github registers for PR polling
  serverEvents.emit('pty:session-created', { terminalId })

  return session
}

// ── Session lookup ──────────────────────────────────────────────────

export function getSession(shellId: number) {
  return sessions.get(shellId)
}

export function getSessionByTerminalId(terminalId: number) {
  // Prefer "main" shell, fallback to any
  for (const session of sessions.values()) {
    if (session.terminalId === terminalId && session.shell.name === 'main') {
      return session
    }
  }
  for (const session of sessions.values()) {
    if (session.terminalId === terminalId) {
      return session
    }
  }
  return undefined
}

export function hasActiveSession(shellId: number) {
  return sessions.has(shellId)
}

export function hasActiveSessionForTerminal(terminalId: number) {
  for (const session of sessions.values()) {
    if (session.terminalId === terminalId) return true
  }
  return false
}

// ── Convenience wrappers (lookup by shellId, delegate to class) ─────

export async function getSessionBuffer(shellId: number) {
  const session = sessions.get(shellId)
  if (!session) return []
  return session.getBuffer()
}

export function writeToSession(shellId: number, data: string) {
  const session = sessions.get(shellId)
  if (!session) return false
  session.write(data)
  return true
}

export function resizeSession(shellId: number, cols: number, rows: number) {
  const session = sessions.get(shellId)
  if (!session) return false
  session.resize(cols, rows)
  return true
}

export function attachSession(
  shellId: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  onCommandEvent?: (event: CommandEvent) => void,
) {
  const session = sessions.get(shellId)
  if (!session) return false
  session.attach(onData, onExit, onCommandEvent)
  return true
}

export function startSessionTimeout(shellId: number) {
  sessions.get(shellId)?.startTimeout()
}

export function clearSessionTimeout(shellId: number) {
  sessions.get(shellId)?.clearTimeout()
}

export function interruptSession(shellId: number) {
  sessions.get(shellId)?.interrupt()
}

export async function killShellChildren(shellId: number) {
  const session = sessions.get(shellId)
  if (!session) return false
  return session.killChildren()
}

export function waitForMarker(shellId: number) {
  const session = sessions.get(shellId)
  if (!session) return Promise.resolve(0)
  return session.waitForMarker()
}

export function cancelWaitForMarker(shellId: number) {
  sessions.get(shellId)?.cancelWaitForMarker()
}

export function updateSessionName(shellId: number, newSessionName: string) {
  sessions.get(shellId)?.updateName(newSessionName)
}

export function destroySession(shellId: number) {
  const session = sessions.get(shellId)
  if (!session) return false
  session.destroy()
  return true
}

// ── Bulk operations ─────────────────────────────────────────────────

export function destroySessionsForTerminal(terminalId: number) {
  const terminalSessions: PtySession[] = []
  for (const session of sessions.values()) {
    if (session.terminalId === terminalId) {
      terminalSessions.push(session)
    }
  }
  if (terminalSessions.length === 0) return false

  const sshHost = terminalSessions[0].sshHost

  for (const session of terminalSessions) {
    if (session.timeoutId) {
      clearTimeout(session.timeoutId)
      session.timeoutId = null
    }
    try {
      session.process.send({ type: 'kill' })
    } catch {
      // IPC channel may already be closed
    }
    setTimeout(() => {
      try {
        session.process.kill('SIGKILL')
      } catch {
        // Already dead
      }
    }, 2000)
    sessions.delete(session.shellId)
  }

  updateTerminal(terminalId, {
    pid: null,
    status: 'stopped',
  }).catch((err) =>
    log.error(
      { err },
      `[pty] Failed to update terminal ${terminalId} on destroy`,
    ),
  )

  serverEvents.emit('pty:terminal-sessions-destroyed', {
    terminalId,
    sshHost,
  })

  return true
}

export function destroyAllSessions() {
  for (const session of sessions.values()) {
    if (session.timeoutId) {
      clearTimeout(session.timeoutId)
    }
    try {
      session.process.send({ type: 'kill' })
    } catch {
      // IPC channel may already be closed
    }
    setTimeout(() => {
      try {
        session.process.kill('SIGKILL')
      } catch {
        // Already dead
      }
    }, 2000)
  }
  sessions.clear()
}

// ── Wait helpers ────────────────────────────────────────────────────

export function waitForSession(shellId: number, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const session = sessions.get(shellId)
    if (session?.ready) {
      resolve(true)
      return
    }
    const start = Date.now()
    const interval = setInterval(() => {
      const s = sessions.get(shellId)
      if (s?.ready) {
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

// ── Pending command (pre-worker) ────────────────────────────────────

export function setPendingCommand(shellId: number, command: string) {
  const session = sessions.get(shellId)
  if (session) {
    session.setPendingCommand(command)
  } else {
    pendingCommands.set(shellId, command)
  }
}

export function flushPendingCommand(shellId: number) {
  const cmd = pendingCommands.get(shellId)
  if (cmd) {
    pendingCommands.delete(shellId)
  }
  return cmd
}

// ── Bell subscriptions ──────────────────────────────────────────────

export function subscribeBell(sub: BellSubscription) {
  const session = sessions.get(sub.shellId)
  if (session) {
    session.subscribeBell(sub)
  }
}

export function unsubscribeBell(shellId: number) {
  const session = sessions.get(shellId)
  if (session) {
    session.unsubscribeBell()
  }
}

export function getBellSubscribedShellIds() {
  const ids: number[] = []
  for (const session of sessions.values()) {
    if (session.bellSubscription) {
      ids.push(session.shellId)
    }
  }
  return ids
}

function emitBellSubscriptions() {
  getIO()?.emit('bell:subscriptions', getBellSubscribedShellIds())
}

/**
 * Handle bell notification on command_end.
 * Called from the command event handler in manager.ts.
 */
export function handleBellNotification(
  session: PtySession,
  event: CommandEvent,
) {
  const bellSub = session.bellSubscription
  if (!bellSub) return

  session.bellSubscription = null
  const command = session.currentCommand || bellSub.command
  getIO()?.emit('bell:notify', {
    shellId: session.shellId,
    terminalId: session.terminalId,
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
    tag: `bell:${session.shellId}`,
  })
  emitBellSubscriptions()
}

// ── Internal helpers for monitor (manager.ts) ───────────────────────

export function getSessionsForTerminal(terminalId: number) {
  const result: PtySession[] = []
  for (const session of sessions.values()) {
    if (session.terminalId === terminalId) result.push(session)
  }
  return result
}

export function getAllSessions() {
  return sessions
}

// ── File helpers ────────────────────────────────────────────────────

export async function writeShellIntegrationScripts() {
  const srcDir = path.join(
    __dirname,
    '..',
    '..',
    'scripts',
    'shell-integration',
  )
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

export async function writeTerminalNameFile(terminalId: number, name: string) {
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

export async function writeShellNameFile(shellId: number, name: string) {
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
    return execSSHCommandLogged(
      sshHost,
      `zellij --session ${shellEscape(oldName)} action rename-session ${shellEscape(newName)}`,
      { category: 'workspace', errorOnly: true, timeout: 5000 },
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
