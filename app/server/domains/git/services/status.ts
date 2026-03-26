import { execFile } from 'node:child_process'
import type {
  GitDiffStat,
  GitLastCommit,
  GitRemoteSyncStat,
} from '@domains/git/schema'
import { detectBranch } from '@domains/git/services/branch-detection'
import { detectGitHubRepo } from '@domains/git/services/resolve'
import {
  getAllTerminals,
  getTerminalById,
  updateTerminal,
} from '@domains/workspace/db/terminals'
import { emitWorkspace } from '@domains/workspace/services/emit'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { log } from '@server/logger'
import { execSSHCommand } from '@server/ssh/exec'

// ── Injected dependencies ────────────────────────────────────────────
// These are provided via initGitStatus() to avoid circular imports
// (git should not import from pty or github).

let hasActiveSessionsFn: (terminalId: number) => boolean = () => true
let getFallbackUsernameFn: () => string | null = () => null

export function initGitStatus(deps: {
  hasActiveSessions: (terminalId: number) => boolean
  getFallbackUsername: () => string | null
}) {
  hasActiveSessionsFn = deps.hasActiveSessions
  getFallbackUsernameFn = deps.getFallbackUsername
}

// ── Per-terminal git state ───────────────────────────────────────────

interface GitTerminalState {
  lastDirty: GitDiffStat | null
  lastRemoteSync: GitRemoteSyncStat | null
  lastCommit: GitLastCommit | null
}

const gitState = new Map<number, GitTerminalState>()

function getOrCreateState(terminalId: number): GitTerminalState {
  let state = gitState.get(terminalId)
  if (!state) {
    state = { lastDirty: null, lastRemoteSync: null, lastCommit: null }
    gitState.set(terminalId, state)
  }
  return state
}

export function disposeGitState(terminalId: number) {
  gitState.delete(terminalId)
}

// ── Pure git helpers ─────────────────────────────────────────────────

function parseDiffNumstat(stdout: string) {
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

function countUntracked(stdout: string) {
  if (!stdout.trim()) return 0
  return stdout.trim().split('\n').length
}

// ── Git status checks ────────────────────────────────────────────────

export async function checkLastCommit(
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

export async function checkGitDirty(
  cwd: string,
  sshHost?: string | null,
): Promise<GitDiffStat> {
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
    return await new Promise<GitDiffStat>((resolve) => {
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
    log.error({ err, cwd }, '[git] Failed to check git dirty status')
    return zero
  }
}

export async function checkGitRemoteSync(
  cwd: string,
  sshHost?: string | null,
): Promise<GitRemoteSyncStat> {
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
    return await new Promise<GitRemoteSyncStat>((resolve) => {
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
    log.error({ err, cwd }, '[git] Failed to check git remote sync')
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

// ── Single-terminal git status check + emit ──────────────────────────

export async function checkAndEmitSingleGitDirty(
  terminalId: number,
  force?: boolean,
) {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal || !terminal.git_branch) return

    const state = getOrCreateState(terminalId)
    const [stat, syncStat, commit] = await Promise.all([
      checkGitDirty(terminal.cwd, terminal.ssh_host),
      checkGitRemoteSync(terminal.cwd, terminal.ssh_host),
      checkLastCommit(terminal.cwd, terminal.ssh_host),
    ])

    const dirtyChanged =
      !state.lastDirty ||
      state.lastDirty.added !== stat.added ||
      state.lastDirty.removed !== stat.removed ||
      state.lastDirty.untracked !== stat.untracked ||
      state.lastDirty.untrackedLines !== stat.untrackedLines
    const commitChanged = commit
      ? !state.lastCommit || state.lastCommit.hash !== commit.hash
      : false

    if (force || dirtyChanged || commitChanged) {
      state.lastDirty = stat
      if (commit) state.lastCommit = commit
      const dirtyStatus: Record<number, GitDiffStat> = {}
      const lastCommit: Record<number, GitLastCommit> = {}
      for (const [id, s] of gitState) {
        if (s.lastDirty) dirtyStatus[id] = s.lastDirty
        if (s.lastCommit) lastCommit[id] = s.lastCommit
      }
      getIO()?.emit('git:dirty-status', { dirtyStatus, lastCommit })
    }

    const syncChanged =
      !state.lastRemoteSync ||
      state.lastRemoteSync.behind !== syncStat.behind ||
      state.lastRemoteSync.ahead !== syncStat.ahead ||
      state.lastRemoteSync.noRemote !== syncStat.noRemote

    if (force || syncChanged) {
      state.lastRemoteSync = syncStat
      const syncStatus: Record<number, GitRemoteSyncStat> = {}
      for (const [id, s] of gitState) {
        if (s.lastRemoteSync) syncStatus[id] = s.lastRemoteSync
      }
      getIO()?.emit('git:remote-sync', { syncStatus })
    }
  } catch (err) {
    log.error({ err }, '[git] Failed to scan and emit git dirty status')
  }
}

// ── Branch detection + DB write ──────────────────────────────────────

export async function detectGitBranch(
  terminalId: number,
  options?: { skipPRRefresh?: boolean },
) {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal) return

    const result = await detectBranch(terminalId, terminal.cwd, terminal)
    if (!result) return

    const { branch } = result

    await updateTerminal(terminalId, { git_branch: branch })
    getIO()?.emit('terminal:updated', {
      terminalId,
      data: { git_branch: branch },
    })
    if (!options?.skipPRRefresh) {
      serverEvents.emit('github:refresh-pr-checks')
    }

    if (!terminal.git_repo) {
      try {
        const repoResult = await detectGitHubRepo(
          terminal.cwd,
          terminal.ssh_host,
          getFallbackUsernameFn(),
        )
        if (repoResult) {
          const gitRepo = {
            repo: `${repoResult.owner}/${repoResult.repo}`,
            status: 'done' as const,
          }
          await updateTerminal(terminalId, { git_repo: gitRepo })
          await emitWorkspace(terminalId, { git_repo: gitRepo })
        }
      } catch (err) {
        log.error({ err, terminalId }, '[git] Failed to detect repo slug')
      }
    }
  } catch (err) {
    log.error(
      { err },
      `[git] Failed to detect git branch for terminal ${terminalId}`,
    )
  }
}

// ── Git dirty polling (all terminals) ────────────────────────────────

let gitDirtyPollingId: NodeJS.Timeout | null = null

async function scanAndEmitGitDirty() {
  const checks: Promise<void>[] = []

  try {
    const terminals = await getAllTerminals()
    for (const terminal of terminals) {
      if (!terminal.git_branch) continue
      if (terminal.ssh_host && !hasActiveSessionsFn(terminal.id)) continue
      const state = getOrCreateState(terminal.id)
      checks.push(
        (async () => {
          try {
            const [stat, syncStat, commit] = await Promise.all([
              checkGitDirty(terminal.cwd, terminal.ssh_host),
              checkGitRemoteSync(terminal.cwd, terminal.ssh_host),
              checkLastCommit(terminal.cwd, terminal.ssh_host),
            ])
            state.lastDirty = stat
            state.lastRemoteSync = syncStat
            if (commit) state.lastCommit = commit

            const branchResult = await detectBranch(
              terminal.id,
              terminal.cwd,
              terminal,
            )
            if (
              branchResult?.branch &&
              branchResult.branch !== terminal.git_branch
            ) {
              await updateTerminal(terminal.id, {
                git_branch: branchResult.branch,
              })
              getIO()?.emit('terminal:updated', {
                terminalId: terminal.id,
                data: { git_branch: branchResult.branch },
              })
            }
          } catch (err) {
            log.error(
              { err, terminalId: terminal.id },
              '[git] Failed to detect branch for terminal',
            )
          }
        })(),
      )
    }
  } catch (err) {
    log.error({ err }, '[git] Failed to detect terminal branches')
    return
  }

  await Promise.all(checks)

  const dirtyStatus: Record<number, GitDiffStat> = {}
  const lastCommit: Record<number, GitLastCommit> = {}
  const syncStatus: Record<number, GitRemoteSyncStat> = {}
  for (const [id, s] of gitState) {
    if (s.lastDirty) dirtyStatus[id] = s.lastDirty
    if (s.lastCommit) lastCommit[id] = s.lastCommit
    if (s.lastRemoteSync) syncStatus[id] = s.lastRemoteSync
  }

  getIO()?.emit('git:dirty-status', { dirtyStatus, lastCommit })
  getIO()?.emit('git:remote-sync', { syncStatus })
}

export function startGitDirtyPolling() {
  if (gitDirtyPollingId) return
  scanAndEmitGitDirty()
  gitDirtyPollingId = setInterval(scanAndEmitGitDirty, 10000)
}

// ── Event listeners ──────────────────────────────────────────────────

serverEvents.on('pty:session-created', ({ terminalId }) => {
  detectGitBranch(terminalId)
})

serverEvents.on('pty:command-end', ({ terminalId }) => {
  detectGitBranch(terminalId)
  checkAndEmitSingleGitDirty(terminalId)
})
