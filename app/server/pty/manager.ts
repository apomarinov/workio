import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pty from 'node-pty'
import type { ActiveProcess } from '../../shared/types'
import {
  getAllTerminals,
  getSettings,
  getTerminalById,
  updateTerminal,
} from '../db'
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
import {
  getActiveZellijSessionNames,
  getListeningPortsForTerminal,
  getSystemListeningPorts,
  getZellijSessionProcesses,
} from './process-tree'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MAX_BUFFER_LINES = 5000
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const LONG_TIMEOUT = 300_000 // 5 min for setup/teardown operations

const COMMAND_IGNORE_LIST: string[] = []

export interface PtySession {
  pty: TerminalBackend
  buffer: string[]
  timeoutId: NodeJS.Timeout | null
  terminalId: number
  sessionName: string // Zellij session name for process detection
  cols: number
  rows: number
  onData: ((data: string) => void) | null
  onExit: ((code: number) => void) | null
  onCommandEvent: ((event: CommandEvent) => void) | null
  currentCommand: string | null
  isIdle: boolean
  lastActiveProcesses: string // For change detection
  onDoneMarker: ((exitCode: number) => void) | null
  processPollTimeoutId: NodeJS.Timeout | null
}

// In-memory map of active PTY sessions
const sessions = new Map<number, PtySession>()

// Global process polling
let globalProcessPollingId: NodeJS.Timeout | null = null

// Git dirty status polling
let gitDirtyPollingId: NodeJS.Timeout | null = null
const lastDirtyStatus = new Map<
  number,
  { added: number; removed: number; untracked: number }
>()
const lastRemoteSyncStatus = new Map<
  number,
  { behind: number; ahead: number; noRemote: boolean }
>()

// Terminal name file helpers for dynamic zellij session naming
const WORKIO_TERMINALS_DIR = path.join(os.homedir(), '.workio', 'terminals')

export async function writeTerminalNameFile(
  terminalId: number,
  name: string,
): Promise<void> {
  try {
    await fs.promises.mkdir(WORKIO_TERMINALS_DIR, { recursive: true })
    await fs.promises.writeFile(
      path.join(WORKIO_TERMINALS_DIR, String(terminalId)),
      name,
    )
  } catch (err) {
    log.error(
      { err },
      `[pty] Failed to write terminal name file for ${terminalId}`,
    )
  }
}

export function renameZellijSession(oldName: string, newName: string): void {
  execFile(
    'zellij',
    ['--session', oldName, 'action', 'rename-session', newName],
    { timeout: 5000 },
    (err) => {
      if (!err) {
        log.info(`[pty] Renamed zellij session ${oldName} to ${newName}`)
      }
      // Session might not exist or not be running, that's ok - silently ignore errors
    },
  )
}

async function getProcessesForTerminal(
  terminalId: number,
  session: PtySession,
): Promise<ActiveProcess[]> {
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

    // Check Zellij session - try session name first, then current terminal name from DB
    // This handles the case where zellij was restarted after a terminal rename
    let zellijProcs = await getZellijSessionProcesses(
      session.sessionName,
      terminalId,
    )
    if (zellijProcs.length === 0) {
      // Try current terminal name from DB (in case zellij restarted with new name)
      const terminal = await getTerminalById(terminalId)
      const currentName = terminal?.name || `terminal-${terminalId}`
      if (currentName !== session.sessionName) {
        zellijProcs = await getZellijSessionProcesses(currentName, terminalId)
        // Update session name if we found processes with the new name
        if (zellijProcs.length > 0) {
          session.sessionName = currentName
        }
      }
    }
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

async function getPortsForTerminal(
  session: PtySession,
  systemPorts: Map<number, number[]>,
): Promise<number[]> {
  const shellPid = session.pty.pid
  return await getListeningPortsForTerminal(
    shellPid,
    session.sessionName,
    systemPorts,
  )
}

async function scanAndEmitProcessesForTerminal(terminalId: number) {
  const session = sessions.get(terminalId)
  if (!session) return

  const processes = await getProcessesForTerminal(terminalId, session)
  const systemPorts = await getSystemListeningPorts()
  const ports = await getPortsForTerminal(session, systemPorts)
  const terminalPorts: Record<number, number[]> = {}
  if (ports.length > 0) {
    terminalPorts[terminalId] = ports
  }
  getIO()?.emit('processes', { terminalId, processes, ports: terminalPorts })
}

async function scanAndEmitAllProcesses() {
  const allProcesses: ActiveProcess[] = []
  const systemPorts = await getSystemListeningPorts()
  const terminalPorts: Record<number, number[]> = {}

  for (const [terminalId, session] of sessions) {
    const procs = await getProcessesForTerminal(terminalId, session)
    allProcesses.push(...procs)

    const ports = await getPortsForTerminal(session, systemPorts)
    if (ports.length > 0) {
      terminalPorts[terminalId] = ports
    }
  }

  // Check for active zellij sessions matching each terminal
  try {
    const zellijSessions = await getActiveZellijSessionNames()
    if (zellijSessions.size > 0) {
      const terminals = await getAllTerminals()
      for (const terminal of terminals) {
        // Try the PTY session name first (set at creation, may differ from current name)
        const ptySession = sessions.get(terminal.id)
        const sessionName = ptySession?.sessionName
        const terminalName = terminal.name || `terminal-${terminal.id}`
        if (
          (sessionName && zellijSessions.has(sessionName)) ||
          zellijSessions.has(terminalName)
        ) {
          allProcesses.push({
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
  } catch {
    // Ignore zellij detection errors
  }

  getIO()?.emit('processes', { processes: allProcesses, ports: terminalPorts })
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

async function checkGitDirty(
  cwd: string,
  sshHost?: string | null,
): Promise<{ added: number; removed: number; untracked: number }> {
  const zero = { added: 0, removed: 0, untracked: 0 }
  try {
    if (sshHost) {
      const [diffResult, untrackedResult] = await Promise.all([
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
      ])
      const diff = parseDiffNumstat(diffResult.stdout)
      return { ...diff, untracked: countUntracked(untrackedResult.stdout) }
    }
    return await new Promise<{
      added: number
      removed: number
      untracked: number
    }>((resolve) => {
      // Run diff and untracked count in parallel
      let diff = { added: 0, removed: 0 }
      let untracked = 0
      let completed = 0
      const checkDone = () => {
        if (++completed === 2) resolve({ ...diff, untracked })
      }

      // Get diff stats
      execFile(
        'git',
        ['diff', '--numstat', 'HEAD'],
        { cwd, timeout: 5000 },
        (err, stdout) => {
          if (err) {
            // No HEAD yet (fresh repo) — fall back to diff without HEAD
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

      // Get untracked count
      execFile(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        { cwd, timeout: 5000 },
        (err, stdout) => {
          if (!err) untracked = countUntracked(stdout)
          checkDone()
        },
      )
    })
  } catch {
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
      // Try @{u} first, fall back to origin/<branch>
      const [behindResult, aheadResult] = await Promise.all([
        execSSHCommand(
          sshHost,
          `REF=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || (git rev-parse --abbrev-ref HEAD | xargs -I {} git rev-parse --verify origin/{} >/dev/null 2>&1 && git rev-parse --abbrev-ref HEAD | xargs -I {} echo origin/{})); [ -n "$REF" ] && git rev-list --count HEAD..$REF`,
          cwd,
        ),
        execSSHCommand(
          sshHost,
          `REF=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || (git rev-parse --abbrev-ref HEAD | xargs -I {} git rev-parse --verify origin/{} >/dev/null 2>&1 && git rev-parse --abbrev-ref HEAD | xargs -I {} echo origin/{})); [ -n "$REF" ] && git rev-list --count $REF..HEAD`,
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
      // First get the remote ref (upstream or origin/<branch>)
      execFile(
        'git',
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        { cwd, timeout: 5000 },
        (upstreamErr, upstreamRef) => {
          if (!upstreamErr && upstreamRef.trim()) {
            // Has upstream, use it
            countRemoteSync(cwd, upstreamRef.trim(), resolve, noRemote)
          } else {
            // No upstream, try origin/<branch>
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
                // Check if origin/<branch> exists
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
  } catch {
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
    { added: number; removed: number; untracked: number }
  > = {}
  const currentSyncStatus: Record<
    number,
    { behind: number; ahead: number; noRemote: boolean }
  > = {}
  const checks: Promise<void>[] = []

  try {
    const terminals = await getAllTerminals()
    for (const terminal of terminals) {
      // Skip terminals that aren't in a git repo
      if (!terminal.git_branch) continue
      // Skip SSH terminals that don't have an active session
      if (terminal.ssh_host && !sessions.has(terminal.id)) continue
      checks.push(
        (async () => {
          try {
            const [stat, syncStat] = await Promise.all([
              checkGitDirty(terminal.cwd, terminal.ssh_host),
              checkGitRemoteSync(terminal.cwd, terminal.ssh_host),
            ])
            currentStatus[terminal.id] = stat
            currentSyncStatus[terminal.id] = syncStat

            // Also detect branch changes
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

            // Only update if branch changed
            if (branch && branch !== terminal.git_branch) {
              await updateTerminal(terminal.id, { git_branch: branch })
              getIO()?.emit('terminal:updated', {
                terminalId: terminal.id,
                data: { git_branch: branch },
              })
            }
          } catch {
            // skip this terminal
          }
        })(),
      )
    }
  } catch {
    return
  }

  await Promise.all(checks)

  // Update dirty status cache
  lastDirtyStatus.clear()
  for (const [id, stat] of Object.entries(currentStatus)) {
    lastDirtyStatus.set(Number(id), stat)
  }

  // Update remote sync cache
  lastRemoteSyncStatus.clear()
  for (const [id, stat] of Object.entries(currentSyncStatus)) {
    lastRemoteSyncStatus.set(Number(id), stat)
  }

  // Always emit — the payload is small and clients may have reconnected
  getIO()?.emit('git:dirty-status', { dirtyStatus: currentStatus })
  getIO()?.emit('git:remote-sync', { syncStatus: currentSyncStatus })
}

export async function checkAndEmitSingleGitDirty(terminalId: number) {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal || !terminal.git_branch) return

    const [stat, syncStat] = await Promise.all([
      checkGitDirty(terminal.cwd, terminal.ssh_host),
      checkGitRemoteSync(terminal.cwd, terminal.ssh_host),
    ])

    // Check if dirty status changed
    const prevDirty = lastDirtyStatus.get(terminalId)
    const dirtyChanged =
      !prevDirty ||
      prevDirty.added !== stat.added ||
      prevDirty.removed !== stat.removed ||
      prevDirty.untracked !== stat.untracked

    if (dirtyChanged) {
      lastDirtyStatus.set(terminalId, stat)
      const dirtyStatus: Record<
        number,
        { added: number; removed: number; untracked: number }
      > = {}
      for (const [id, s] of lastDirtyStatus) {
        dirtyStatus[id] = s
      }
      getIO()?.emit('git:dirty-status', { dirtyStatus })
    }

    // Check if remote sync status changed
    const prevSync = lastRemoteSyncStatus.get(terminalId)
    const syncChanged =
      !prevSync ||
      prevSync.behind !== syncStat.behind ||
      prevSync.ahead !== syncStat.ahead ||
      prevSync.noRemote !== syncStat.noRemote

    if (syncChanged) {
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
  } catch {
    // ignore
  }
}

export function startGitDirtyPolling() {
  if (gitDirtyPollingId) return
  scanAndEmitGitDirty()
  gitDirtyPollingId = setInterval(scanAndEmitGitDirty, 10000)
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
      await updateTerminal(terminalId, { git_branch: branch })
      getIO()?.emit('terminal:updated', {
        terminalId,
        data: { git_branch: branch },
      })
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
  const terminal = await getTerminalById(terminalId)
  if (!terminal) {
    log.error(`[pty] Terminal not found: ${terminalId}`)
    return null
  }

  // Compute session name for zellij (used for process detection)
  const terminalName = terminal.name || `terminal-${terminalId}`

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
    try {
      await fs.promises.access(terminal.cwd)
    } catch {
      log.error(`[pty] Working directory does not exist: ${terminal.cwd}`)
      return null
    }

    // Get shell - use terminal's shell, default from settings, or fallback to SHELL env
    const settings = await getSettings()
    let shell = terminal.shell || settings.default_shell

    // Helper to check if a path exists
    const exists = async (p: string) => {
      try {
        await fs.promises.access(p)
        return true
      } catch {
        return false
      }
    }

    // Fallback to environment shell if specified shell doesn't exist
    if (!(await exists(shell))) {
      const envShell = process.env.SHELL
      if (envShell && (await exists(envShell))) {
        log.warn(`[pty] Shell ${shell} not found, falling back to ${envShell}`)
        shell = envShell
      } else {
        // Last resort fallback
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
          WORKIO_TERMINAL_ID: String(terminalId),
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
    sessionName: terminalName,
    cols,
    rows,
    onData,
    onExit,
    onCommandEvent: onCommandEvent || null,
    currentCommand: null,
    isIdle: true,
    lastActiveProcesses: '',
    onDoneMarker: null,
    processPollTimeoutId: null,
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
          updateTerminal(terminalId, { active_cmd: null }).catch(() => {})
          log.info(`[pty:${terminalId}] Shell idle (waiting for input)`)
          break
        case 'done_marker':
          if (session.onDoneMarker) {
            const cb = session.onDoneMarker
            session.onDoneMarker = null
            cb(event.exitCode ?? 0)
          }
          break
        case 'command_start':
          session.isIdle = false
          session.currentCommand = event.command || null
          updateTerminal(terminalId, {
            active_cmd: event.command || null,
          }).catch(() => {})
          log.info(`[pty:${terminalId}] Command started: ${event.command}`)
          session.processPollTimeoutId = setTimeout(() => {
            session.processPollTimeoutId = null
            scanAndEmitProcessesForTerminal(terminalId)
          }, 1000)
          break
        case 'command_end':
          if (session.processPollTimeoutId) {
            clearTimeout(session.processPollTimeoutId)
            session.processPollTimeoutId = null
          }
          log.info(
            `[pty:${terminalId}] Command finished (exit code: ${event.exitCode})`,
          )
          detectGitBranch(terminalId)
          checkAndEmitSingleGitDirty(terminalId)
          setTimeout(() => {
            scanAndEmitProcessesForTerminal(terminalId)
          }, 1000)
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
    lastDirtyStatus.delete(terminalId)
    lastRemoteSyncStatus.delete(terminalId)
    stopGlobalProcessPolling()
    updateTerminal(terminalId, {
      pid: null,
      status: 'stopped',
      active_cmd: null,
    }).catch(() => {})
    session.onExit?.(exitCode)
  })

  // Update terminal with PID (SSH sessions have no local PID)
  await updateTerminal(terminalId, {
    pid: backend.pid || null,
    status: 'running',
  })

  sessions.set(terminalId, session)

  // Start global polling if not already running
  startGlobalProcessPolling()

  // Write terminal name file for dynamic zellij session naming (fire-and-forget)
  writeTerminalNameFile(terminalId, terminalName).catch(() => {})

  // wioname function to read current terminal name (for zellij session naming)
  const wionameFunc = `wioname() { cat "${WORKIO_TERMINALS_DIR}/${terminalId}" 2>/dev/null || echo "terminal-${terminalId}"; }`

  if (terminal.ssh_host) {
    // Inject shell integration for SSH terminals inline via heredoc
    const sshScriptPath = path.join(
      __dirname,
      'shell-integration',
      'ssh-inline.sh',
    )
    fs.promises
      .readFile(sshScriptPath, 'utf-8')
      .then((inlineScript) => {
        setTimeout(() => {
          // Use heredoc + eval so the script is interpreted with real newlines
          const injection = `eval "$(cat <<'__SHELL_INTEGRATION_EOF__'\n${inlineScript}\n__SHELL_INTEGRATION_EOF__\n)"\n`
          backend.write(injection)
          backend.write(`${wionameFunc}\n`)
          if (terminal.cwd && terminal.cwd !== '~') {
            backend.write(`cd ${terminal.cwd}\n`)
          }
          backend.write("printf '\\033c\\x1b[1;1H'\n")
          backend.write('clear\n')
        }, 200)
      })
      .catch((err) => {
        log.error({ err }, '[pty] Failed to inject SSH shell integration')
        // Still cd into cwd even if integration fails
        if (terminal.cwd && terminal.cwd !== '~') {
          setTimeout(() => {
            backend.write(`cd ${terminal.cwd}\n`)
          }, 200)
        }
      })
  } else {
    // Inject shell integration for local terminals via source
    const shellSettings = await getSettings()
    const shell = terminal.shell || shellSettings.default_shell || '/bin/bash'
    const shellName = path.basename(shell)
    let integrationScript: string | null = null

    if (shellName === 'zsh') {
      integrationScript = path.join(__dirname, 'shell-integration', 'zsh.sh')
    } else if (shellName === 'bash') {
      integrationScript = path.join(__dirname, 'shell-integration', 'bash.sh')
    }

    // Check if integration script exists before the timeout
    const scriptExists = integrationScript
      ? await fs.promises
          .access(integrationScript)
          .then(() => true)
          .catch(() => false)
      : false

    setTimeout(() => {
      if (integrationScript && scriptExists) {
        // Source the integration silently, then reset and position cursor at top
        backend.write(
          `source "${integrationScript}"; ${wionameFunc}; printf '\\033c\\x1b[1;1H'\n`,
        )
        backend.write('clear\n')
      } else {
        // Still inject wioname even without shell integration
        backend.write(`${wionameFunc}\n`)
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

  // Update database (fire-and-forget since PTY is already killed)
  updateTerminal(terminalId, {
    pid: null,
    status: 'stopped',
    active_cmd: null,
  }).catch(() => {})

  sessions.delete(terminalId)
  lastDirtyStatus.delete(terminalId)
  lastRemoteSyncStatus.delete(terminalId)
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

export function waitForMarker(terminalId: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const session = sessions.get(terminalId)
    if (!session) {
      resolve(0)
      return
    }
    const timeout = setTimeout(() => {
      session.onDoneMarker = null
      reject(new Error(`waitForMarker timed out for terminal ${terminalId}`))
    }, LONG_TIMEOUT)
    session.onDoneMarker = (exitCode: number) => {
      clearTimeout(timeout)
      resolve(exitCode)
    }
  })
}

export function waitForSession(
  terminalId: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (sessions.has(terminalId)) {
      resolve(true)
      return
    }
    const start = Date.now()
    const interval = setInterval(() => {
      if (sessions.has(terminalId)) {
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

export function interruptSession(terminalId: number): void {
  const session = sessions.get(terminalId)
  if (session) {
    session.pty.write('\x03')
  }
}
