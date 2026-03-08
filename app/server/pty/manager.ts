import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNotification } from '../../shared/notifications'
import type { ActiveProcess, GitLastCommit } from '../../shared/types'
import {
  getAllTerminals,
  getTerminalById,
  updateShell,
  updateTerminal,
} from '../db'
import {
  getGhUsername,
  refreshPRChecks,
  untrackTerminal,
} from '../github/checks'
import { getIO } from '../io'
import { log } from '../logger'
import { sendPushNotification } from '../push'
import { execSSHCommand } from '../ssh/exec'
import { emitWorkspace } from '../workspace/setup'
import type { CommandEvent } from './osc-parser'
import {
  getActiveZellijSessionNames,
  getChildPids,
  getListeningPortsForTerminal,
  getProcessComm,
  getSystemListeningPorts,
  getZellijSessionProcesses,
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

const COMMAND_IGNORE_LIST: string[] = []

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
}

async function getProcessesForTerminal(
  terminalId: number,
  session: ProcessScanSession,
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
        zellijProcs = await getZellijSessionProcesses(expectedName, terminalId)
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
  } catch (err) {
    log.error({ err }, '[pty] Failed to get zellij processes')
  }

  return processes
}

async function getPortsForTerminal(
  session: ProcessScanSession,
  systemPorts: Map<number, number[]>,
): Promise<number[]> {
  return await getListeningPortsForTerminal(
    session.pty.pid,
    session.sessionName,
    systemPorts,
  )
}

async function scanAndEmitProcessesForTerminal(terminalId: number) {
  const handles = getWorkersForTerminal(terminalId)
  if (handles.length === 0) return

  const allProcesses: ActiveProcess[] = []
  const systemPorts = await getSystemListeningPorts()
  const allPorts: number[] = []
  const shellPorts: Record<number, number[]> = {}

  await Promise.all(
    handles.map(async (h) => {
      const session: ProcessScanSession = {
        currentCommand: h.currentCommand,
        pty: { pid: h.ptyPid },
        sessionName: h.sessionName,
        shell: h.shell,
      }
      const [procs, ports] = await Promise.all([
        getProcessesForTerminal(terminalId, session),
        getPortsForTerminal(session, systemPorts),
      ])
      allProcesses.push(...procs)
      allPorts.push(...ports)
      if (ports.length > 0) {
        shellPorts[h.shell.id] = [...new Set(ports)].sort((a, b) => a - b)
      }

      // Clear stale active_cmd if no actual process found after multiple scans
      if (h.currentCommand) {
        if (procs.some((p) => p.source === 'direct' && p.pid > 0)) {
          h.staleScanCount = 0
        } else {
          h.staleScanCount++
          log.info(
            `[pty] t=${terminalId} s=${h.shell.id} stale scan ${h.staleScanCount}/3 for "${h.currentCommand}"`,
          )
          if (h.staleScanCount >= 3) {
            log.info(
              `[pty] t=${terminalId} s=${h.shell.id} clearing stale active_cmd "${h.currentCommand}"`,
            )
            h.currentCommand = null
            h.staleScanCount = 0
            emitShellUpdate(terminalId, h.shell.id, { active_cmd: null })
          }
        }
      }
    }),
  )

  stampProcessStartTimes(allProcesses)

  const terminalPorts: Record<number, number[]> = {}
  if (allPorts.length > 0) {
    terminalPorts[terminalId] = [...new Set(allPorts)].sort((a, b) => a - b)
  }
  getIO()?.emit('processes', {
    terminalId,
    processes: allProcesses,
    ports: terminalPorts,
    shellPorts,
  })
}

async function scanAndEmitAllProcesses() {
  const workers = getAllWorkers()
  const allProcesses: ActiveProcess[] = []
  const systemPorts = await getSystemListeningPorts()
  const terminalPorts: Record<number, number[]> = {}
  const shellPorts: Record<number, number[]> = {}

  await Promise.all(
    [...workers.values()].map(async (h) => {
      const session: ProcessScanSession = {
        currentCommand: h.currentCommand,
        pty: { pid: h.ptyPid },
        sessionName: h.sessionName,
        shell: h.shell,
      }
      const [procs, ports] = await Promise.all([
        getProcessesForTerminal(h.terminalId, session),
        getPortsForTerminal(session, systemPorts),
      ])
      allProcesses.push(...procs)

      if (ports.length > 0) {
        const existing = terminalPorts[h.terminalId] || []
        terminalPorts[h.terminalId] = [
          ...new Set([...existing, ...ports]),
        ].sort((a, b) => a - b)
        shellPorts[h.shell.id] = [...new Set(ports)].sort((a, b) => a - b)
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
            log.info(
              `[pty] t=${h.terminalId} s=${h.shell.id} clearing stale active_cmd "${h.currentCommand}"`,
            )
            h.currentCommand = null
            h.staleScanCount = 0
            emitShellUpdate(h.terminalId, h.shell.id, { active_cmd: null })
          }
        }
      }
    }),
  )

  // Check for active zellij sessions
  try {
    const zellijSessions = await getActiveZellijSessionNames()
    if (zellijSessions.size > 0) {
      const sessionTerminalIds = new Set<number>()
      for (const h of workers.values()) {
        sessionTerminalIds.add(h.terminalId)
        if (zellijSessions.has(h.sessionName)) {
          allProcesses.push({
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
        if (zellijSessions.has(terminalName)) {
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
  } catch (err) {
    log.error({ err }, '[pty] Failed to detect zellij sessions')
  }

  stampProcessStartTimes(allProcesses)

  getIO()?.emit('processes', {
    processes: allProcesses,
    ports: terminalPorts,
    shellPorts,
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
  { added: number; removed: number; untracked: number }
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
        execSSHCommand(sshHost, 'git config user.name', cwd),
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
): Promise<{ added: number; removed: number; untracked: number }> {
  const zero = { added: 0, removed: 0, untracked: 0 }
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
        added: diff.added + untrackedLines,
        removed: diff.removed,
        untracked: countUntracked(untrackedResult.stdout),
      }
    }
    return await new Promise<{
      added: number
      removed: number
      untracked: number
    }>((resolve) => {
      let diff = { added: 0, removed: 0 }
      let untracked = 0
      let untrackedLines = 0
      let completed = 0
      const checkDone = () => {
        if (++completed === 3)
          resolve({
            added: diff.added + untrackedLines,
            removed: diff.removed,
            untracked,
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
    { added: number; removed: number; untracked: number }
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

export async function checkAndEmitSingleGitDirty(terminalId: number) {
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
      prevDirty.untracked !== stat.untracked
    const commitChanged = commit
      ? !prevCommit || prevCommit.hash !== commit.hash
      : false

    if (dirtyChanged || commitChanged) {
      lastDirtyStatus.set(terminalId, stat)
      if (commit) lastCommitStatus.set(terminalId, commit)
      const dirtyStatus: Record<
        number,
        { added: number; removed: number; untracked: number }
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
      name,
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
      name,
    )
  } catch (err) {
    log.error({ err }, `[pty] Failed to write shell name file for ${shellId}`)
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
    },
  )
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
  const result = proxyDestroySessionsForTerminal(terminalId)
  if (result) {
    for (const h of handles) {
      bellSubscriptions.delete(h.shellId)
    }
    lastDirtyStatus.delete(terminalId)
    lastRemoteSyncStatus.delete(terminalId)
    stopGlobalProcessPolling()
    untrackTerminal(terminalId)
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

    case 'done_marker':
      // done_marker is handled by the proxy's onDoneMarker callback
      break
  }
}

// Register the command event handler with the session proxy
setCommandEventHandler(handleWorkerCommandEvent)

// Start process polling when module loads (sessions may exist from proxy)
startGlobalProcessPolling()
