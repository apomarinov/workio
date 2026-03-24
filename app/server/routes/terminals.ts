import fs from 'node:fs'
import path from 'node:path'
import { logCommand } from '@domains/logs/db'
import type { FastifyInstance } from 'fastify'
import { execFileAsync } from '../lib/exec'

function parseUntrackedWc(wcOut: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of wcOut.trim().split('\n')) {
    if (!line) continue
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (match && match[2] !== 'total') {
      map.set(match[2], Number(match[1]) || 0)
    }
  }
  return map
}

function parseChangedFiles(
  numstatOut: string,
  nameStatusOut: string,
  untrackedOut: string,
  untrackedWcOut?: string,
) {
  type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
  interface ChangedFile {
    path: string
    status: FileStatus
    added: number
    removed: number
    oldPath?: string
  }

  // Parse --numstat: <added>\t<removed>\t<path>
  const numstatMap = new Map<string, { added: number; removed: number }>()
  for (const line of numstatOut.trim().split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const added = parts[0] === '-' ? 0 : Number(parts[0]) || 0
    const removed = parts[1] === '-' ? 0 : Number(parts[1]) || 0
    // For renames, numstat shows: added removed old => new
    const filePath = parts.slice(2).join('\t')
    numstatMap.set(filePath, { added, removed })
  }

  // Parse --name-status: <status>\t<path> (or <status>\t<old>\t<new> for renames)
  const statusMap = new Map<string, { status: FileStatus; oldPath?: string }>()
  for (const line of nameStatusOut.trim().split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const code = parts[0]
    if (code.startsWith('R')) {
      statusMap.set(parts[2], { status: 'renamed', oldPath: parts[1] })
    } else {
      const status: FileStatus =
        code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
      statusMap.set(parts[1], { status })
    }
  }

  const files: ChangedFile[] = []

  // Merge status + numstat
  for (const [filePath, { status, oldPath }] of statusMap) {
    const numstatKey =
      status === 'renamed' && oldPath ? `${oldPath} => ${filePath}` : filePath
    const stats = numstatMap.get(numstatKey) ??
      numstatMap.get(filePath) ?? { added: 0, removed: 0 }
    files.push({
      path: filePath,
      status,
      added: stats.added,
      removed: stats.removed,
      ...(oldPath && { oldPath }),
    })
  }

  // Untracked files
  const untrackedWcMap = untrackedWcOut
    ? parseUntrackedWc(untrackedWcOut)
    : undefined
  for (const line of untrackedOut.trim().split('\n')) {
    if (!line) continue
    // Skip if already present from diff
    if (!statusMap.has(line)) {
      const added = untrackedWcMap?.get(line) ?? 0
      files.push({ path: line, status: 'untracked', added, removed: 0 })
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

import {
  checkAndEmitSingleGitDirty,
  detectGitBranch,
} from '@domains/pty/monitor'
import { getTerminalById } from '@domains/workspace/db/terminals'
import { gitExec, gitExecLogged } from '../lib/git'
import { expandPath, shellEscape } from '../lib/strings'
import { log } from '../logger'
import { execSSHCommand } from '../ssh/exec'

interface UndoCommitBody {
  commitHash: string
}

interface DropCommitBody {
  commitHash: string
}

interface TerminalParams {
  id: string
}

function parseId(raw: string, label = 'terminal'): number {
  const id = parseInt(raw, 10)
  if (Number.isNaN(id)) {
    const err = new Error(`Invalid ${label} id`) as Error & {
      statusCode: number
    }
    err.statusCode = 400
    throw err
  }
  return id
}

async function resolveTerminal(params: TerminalParams) {
  const id = parseId(params.id)
  const terminal = await getTerminalById(id)
  if (!terminal) {
    const err = new Error('Terminal not found') as Error & {
      statusCode: number
    }
    err.statusCode = 404
    throw err
  }
  return terminal
}

async function resolveGitTerminal(params: TerminalParams) {
  const terminal = await resolveTerminal(params)
  if (!terminal.git_repo) {
    const err = new Error('Not a git repository') as Error & {
      statusCode: number
    }
    err.statusCode = 400
    throw err
  }
  return terminal as typeof terminal & {
    git_repo: NonNullable<(typeof terminal)['git_repo']>
  }
}

export default async function terminalRoutes(fastify: FastifyInstance) {
  // Cache git fetch calls to avoid redundant network round-trips.
  // Key: "cwd\0" + sorted refspecs, Value: timestamp of last fetch
  const fetchCache = new Map<string, number>()

  async function fetchOriginIfNeeded(
    cwd: string,
    refspecs: string[],
    ttlMs = 30000,
  ): Promise<void> {
    const key = `${cwd}\0${[...refspecs].sort().join('\0')}`
    const last = fetchCache.get(key)
    if (last && Date.now() - last < ttlMs) {
      return Promise.resolve()
    }
    try {
      await execFileAsync('git', ['fetch', 'origin', ...refspecs], {
        cwd,
        timeout: 30000,
      })
    } catch {
      // fetch failure is non-fatal
    } finally {
      fetchCache.set(key, Date.now())
    }
  }

  // Get HEAD commit message
  fastify.get<{ Params: TerminalParams }>(
    '/api/terminals/:id/head-message',
    async (request, reply) => {
      const terminal = await resolveGitTerminal(request.params)

      try {
        const result = await gitExec(terminal, ['log', '-1', '--format=%B'], {
          timeout: 10000,
        })

        return { message: result.stdout.trim() }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get HEAD message'
        return reply.status(400).send({ error: errorMessage })
      }
    },
  )

  // Get changed files with per-file stats
  fastify.get<{ Params: TerminalParams; Querystring: { base?: string } }>(
    '/api/terminals/:id/changed-files',
    async (request, reply) => {
      const terminal = await resolveGitTerminal(request.params)

      try {
        const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)
        const base = request.query.base

        // When base is provided, diff between two refs (for PR view)
        if (base) {
          // Fetch the relevant branches first
          const parts = base.split('...')
          const refs = parts
            .map((p) => p.replace(/^origin\//, '').replace(/\^$/, ''))
            .filter((r) => !/^[0-9a-f]{6,}$/i.test(r)) // skip commit hashes
          if (refs.length > 0) {
            if (terminal.ssh_host) {
              const refspecs = refs
                .map((r) => `+refs/heads/${r}:refs/remotes/origin/${r}`)
                .join(' ')
              await gitExec(terminal, [], {
                timeout: 15000,
                sshCmd: `git fetch origin ${refspecs} 2>/dev/null || true`,
              }).catch(() => {})
            } else {
              const refspecs = refs.map(
                (r) => `+refs/heads/${r}:refs/remotes/origin/${r}`,
              )
              await fetchOriginIfNeeded(cwd, refspecs)
            }
          }

          const [numstat, nameStatus] = await Promise.all([
            gitExec(terminal, ['diff', '--numstat', base], {
              timeout: 10000,
            }).then(
              (r) => r.stdout,
              () => '',
            ),
            gitExec(terminal, ['diff', '--name-status', base], {
              timeout: 10000,
            }).then(
              (r) => r.stdout,
              () => '',
            ),
          ])
          return { files: parseChangedFiles(numstat, nameStatus, '', '') }
        }

        // No base: diff working tree against HEAD
        const gitExecSafe = (args: string[], sshCmd?: string) =>
          gitExec(terminal, args, { timeout: 10000, sshCmd }).then(
            (r) => r.stdout,
            () => '',
          )

        const [numstatOut, nameStatusOut, untrackedOut, untrackedWcOut] =
          await Promise.all([
            gitExecSafe(['diff', '--numstat', 'HEAD']).then(
              (out) => out || gitExecSafe(['diff', '--numstat']),
            ),
            gitExecSafe(['diff', '--name-status', 'HEAD']).then(
              (out) => out || gitExecSafe(['diff', '--name-status']),
            ),
            gitExecSafe(['ls-files', '--others', '--exclude-standard']),
            gitExecSafe(
              ['ls-files', '-z', '--others', '--exclude-standard'],
              'git ls-files -z --others --exclude-standard | xargs -0 wc -l 2>/dev/null',
            ),
          ])

        const files = parseChangedFiles(
          numstatOut,
          nameStatusOut,
          untrackedOut,
          untrackedWcOut,
        )
        return { files }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get changed files'
        return reply.status(400).send({ error: errorMessage })
      }
    },
  )

  // Get diff for a single file (or all files when path is omitted)
  fastify.get<{
    Params: TerminalParams
    Querystring: { path?: string; context?: string; base?: string }
  }>('/api/terminals/:id/file-diff', async (request, reply) => {
    const terminal = await resolveGitTerminal(request.params)

    const filePath = request.query.path
    const context = request.query.context || '5'
    const base = request.query.base

    const safe = (
      args: string[],
      extraOpts?: { maxBuffer?: number; sshCmd?: string },
    ) =>
      gitExec(terminal, args, { timeout: 10000, ...extraOpts }).then(
        (r) => r.stdout,
        () => '',
      )

    try {
      // When base is provided, diff between two refs (for PR view)
      if (base) {
        const args = ['diff', `-U${context}`, base]
        if (filePath) args.push('--', filePath)
        const diff = await safe(args, { maxBuffer: 10 * 1024 * 1024 })
        return { diff }
      }

      if (filePath) {
        // Try tracked file diff first, then fallback for fresh repos
        let diff = await safe(['diff', `-U${context}`, 'HEAD', '--', filePath])
        if (!diff) {
          diff = await safe(['diff', `-U${context}`, '--', filePath])
        }
        if (!diff.trim()) {
          // Try untracked file (exit code 1 is normal for --no-index)
          diff = await safe(['diff', '--no-index', '--', '/dev/null', filePath])
        }
        return { diff }
      }

      // Full diff (all files — tracked + untracked)
      let diff = await safe(['diff', `-U${context}`, 'HEAD'], {
        maxBuffer: 10 * 1024 * 1024,
      })
      if (!diff) {
        diff = await safe(['diff', `-U${context}`], {
          maxBuffer: 10 * 1024 * 1024,
        })
      }

      // Append untracked files
      const untrackedFiles = (
        await safe(['ls-files', '--others', '--exclude-standard'])
      ).trim()

      if (untrackedFiles) {
        const untrackedParts: string[] = []
        for (const file of untrackedFiles.split('\n')) {
          if (!file) continue
          const part = await safe([
            'diff',
            '--no-index',
            '--',
            '/dev/null',
            file,
          ])
          if (part) untrackedParts.push(part)
        }
        if (untrackedParts.length > 0) {
          diff = `${diff}\n${untrackedParts.join('\n')}`
        }
      }

      return { diff }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to get file diff'
      return reply.status(400).send({ error: errorMessage })
    }
  })

  // Commit changes
  fastify.post<{
    Params: TerminalParams
    Body: {
      message: string
      amend?: boolean
      noVerify?: boolean
      files?: string[]
    }
  }>('/api/terminals/:id/commit', async (request, reply) => {
    const terminal = await resolveGitTerminal(request.params)
    const id = terminal.id

    const { message, amend, noVerify, files } = request.body

    try {
      // Stage files
      if (files && files.length > 0) {
        // Selective staging: reset then add specific files
        await gitExec(terminal, ['reset', 'HEAD'], { timeout: 30000 }).catch(
          (err) =>
            log.error(
              { err, terminalId: id },
              '[git] Failed to reset HEAD (may be fresh repo)',
            ),
        )
        await gitExecLogged(terminal, ['add', '--', ...files], {
          terminalId: id,
          timeout: 30000,
        })
      } else {
        // Stage all changes (default)
        await gitExecLogged(terminal, ['add', '-A'], {
          terminalId: id,
          timeout: 30000,
        })
      }

      if (amend) {
        const amendArgs = ['commit', '--amend', '--no-edit']
        if (noVerify) amendArgs.push('--no-verify')
        await gitExecLogged(terminal, amendArgs, {
          terminalId: id,
          timeout: 30000,
        })
      } else {
        if (!message?.trim()) {
          return reply.status(400).send({ error: 'Commit message is required' })
        }
        const commitArgs = ['commit', '-m', message]
        if (noVerify) commitArgs.push('--no-verify')
        await gitExecLogged(terminal, commitArgs, {
          terminalId: id,
          timeout: 30000,
        })
      }

      // Refresh git state
      detectGitBranch(id).catch((err) =>
        log.error({ err, terminalId: id }, '[git] Failed to detect branch'),
      )
      checkAndEmitSingleGitDirty(id, true)

      return { success: true }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to commit'
      return reply.status(400).send({
        success: false,
        error: errorMessage,
      })
    }
  })

  // Discard changes for selected files
  fastify.post<{
    Params: TerminalParams
    Body: { files: string[] }
  }>('/api/terminals/:id/discard', async (request, reply) => {
    const terminal = await resolveGitTerminal(request.params)
    const id = terminal.id

    const { files } = request.body
    if (!files || files.length === 0) {
      return reply.status(400).send({ error: 'No files specified' })
    }

    try {
      // Get file statuses to determine which git commands to use
      const safe = (args: string[]) =>
        gitExec(terminal, args, { timeout: 10000 }).then(
          (r) => r.stdout,
          () => '',
        )

      const [nameStatusOut, untrackedOut] = await Promise.all([
        safe(['diff', '--name-status', 'HEAD']).then(
          (out) => out || safe(['diff', '--name-status']),
        ),
        safe(['ls-files', '--others', '--exclude-standard']),
      ])

      // Parse statuses
      const untrackedFiles = new Set(
        untrackedOut
          .trim()
          .split('\n')
          .filter((l) => l),
      )
      const addedFiles = new Set<string>()
      for (const line of nameStatusOut.trim().split('\n')) {
        if (!line) continue
        const parts = line.split('\t')
        if (parts[0] === 'A') addedFiles.add(parts[1])
      }

      const requestedSet = new Set(files)
      // Tracked files (modified/deleted/renamed): git checkout HEAD --
      const trackedToRevert = files.filter(
        (f) => !untrackedFiles.has(f) && !addedFiles.has(f),
      )
      // Staged new files: git rm -f --
      const stagedNew = files.filter(
        (f) => addedFiles.has(f) && requestedSet.has(f),
      )
      // Untracked files: delete directly
      const untracked = files.filter(
        (f) => untrackedFiles.has(f) && requestedSet.has(f),
      )

      // Revert tracked files
      if (trackedToRevert.length > 0) {
        await gitExecLogged(
          terminal,
          ['checkout', 'HEAD', '--', ...trackedToRevert],
          {
            terminalId: id,
            timeout: 30000,
          },
        )
      }

      // Remove staged new files
      if (stagedNew.length > 0) {
        await gitExecLogged(terminal, ['rm', '-f', '--', ...stagedNew], {
          terminalId: id,
          timeout: 30000,
        })
      }

      // Delete untracked files
      if (untracked.length > 0) {
        if (terminal.ssh_host) {
          const rmCmd = `rm -f -- ${untracked.map((f) => shellEscape(f)).join(' ')}`
          await execSSHCommand(terminal.ssh_host, rmCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: rmCmd,
            stdout: '',
            stderr: '',
          })
        } else {
          const cwdPath = expandPath(terminal.cwd)
          await Promise.all(
            untracked.map((f) =>
              fs.promises
                .unlink(path.join(cwdPath, f))
                .catch((err) =>
                  log.error(
                    { err, file: f },
                    '[git] Failed to delete untracked file',
                  ),
                ),
            ),
          )
          logCommand({
            terminalId: id,
            category: 'git',
            command: `rm ${untracked.join(' ')}`,
            stdout: '',
            stderr: '',
          })
        }
      }

      // Refresh dirty state
      checkAndEmitSingleGitDirty(id, true)

      return { success: true }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to discard changes'
      return reply.status(400).send({
        success: false,
        error: errorMessage,
      })
    }
  })

  // Undo the most recent commit (soft reset)
  fastify.post<{ Params: TerminalParams; Body: UndoCommitBody }>(
    '/api/terminals/:id/undo-commit',
    async (request, reply) => {
      const terminal = await resolveGitTerminal(request.params)
      const id = terminal.id

      const { commitHash } = request.body
      if (!commitHash) {
        return reply.status(400).send({ error: 'commitHash is required' })
      }

      try {
        // Verify commitHash matches HEAD
        const headResult = await gitExec(terminal, ['rev-parse', 'HEAD'], {
          timeout: 5000,
        })
        const headHash = headResult.stdout.trim()

        if (
          !headHash.startsWith(commitHash) &&
          !commitHash.startsWith(headHash.slice(0, commitHash.length))
        ) {
          return reply.status(400).send({
            error: 'Commit is not the current HEAD',
          })
        }

        // git reset --soft HEAD~1
        await gitExecLogged(terminal, ['reset', '--soft', 'HEAD~1'], {
          terminalId: id,
          timeout: 10000,
        })

        detectGitBranch(id)
        checkAndEmitSingleGitDirty(id)

        return { success: true }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to undo commit'
        return reply.status(400).send({
          success: false,
          error: errorMessage,
        })
      }
    },
  )

  // Drop a specific commit via non-interactive rebase
  fastify.post<{ Params: TerminalParams; Body: DropCommitBody }>(
    '/api/terminals/:id/drop-commit',
    async (request, reply) => {
      const terminal = await resolveGitTerminal(request.params)
      const id = terminal.id

      const { commitHash } = request.body
      if (!commitHash) {
        return reply.status(400).send({ error: 'commitHash is required' })
      }

      try {
        // Get parent of the commit to drop
        const parentResult = await gitExec(
          terminal,
          ['rev-parse', `${commitHash}~1`],
          { timeout: 5000 },
        )
        const parentHash = parentResult.stdout.trim()

        // Use sed to change "pick <hash>" to "drop <hash>" for this commit
        const shortHash = commitHash.slice(0, 7)
        const sedScript = `sed -i.bak 's/^pick ${shortHash}/drop ${shortHash}/'`

        await gitExecLogged(
          terminal,
          ['rebase', '-i', '--no-autosquash', parentHash],
          {
            terminalId: id,
            timeout: 60000,
            env: { GIT_SEQUENCE_EDITOR: sedScript },
          },
        )

        detectGitBranch(id)
        checkAndEmitSingleGitDirty(id)

        return { success: true }
      } catch (err) {
        // Abort the rebase to leave repo in clean state
        await gitExec(terminal, ['rebase', '--abort'], {
          timeout: 10000,
        }).catch(() => {})

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to drop commit'
        return reply.status(400).send({
          success: false,
          error: errorMessage,
        })
      }
    },
  )

  // Check for merge conflicts between two branches
  fastify.get<{
    Params: TerminalParams
    Querystring: { head: string; base: string }
  }>('/api/terminals/:id/branch-conflicts', async (request, reply) => {
    const terminal = await resolveTerminal(request.params)

    const { head, base } = request.query
    if (!head || !base) {
      return reply.status(400).send({ error: 'head and base are required' })
    }

    try {
      const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

      // Fetch latest refs first (use explicit refspecs to create remote tracking refs)
      if (!terminal.ssh_host) {
        const refspecs = [head, base].map(
          (r) => `+refs/heads/${r}:refs/remotes/origin/${r}`,
        )
        await fetchOriginIfNeeded(cwd, refspecs)
      }

      const hasConflicts = await gitExec(
        terminal,
        [
          'merge-tree',
          '--write-tree',
          '--no-messages',
          `origin/${base}`,
          `origin/${head}`,
        ],
        { timeout: 15000 },
      )
        .then(() => false)
        .catch(() => true)

      return { hasConflicts }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to check conflicts'
      return reply.status(400).send({ error: errorMessage })
    }
  })

  // Get commits between two branches
  fastify.get<{
    Params: TerminalParams
    Querystring: { head: string; base: string }
  }>('/api/terminals/:id/commits', async (request, reply) => {
    const terminal = await resolveTerminal(request.params)

    const { head, base } = request.query
    if (!head || !base) {
      return reply.status(400).send({ error: 'head and base are required' })
    }

    try {
      const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

      // Fetch latest refs first (use explicit refspecs to create remote tracking refs)
      if (!terminal.ssh_host) {
        const refspecs = [head, base].map(
          (r) => `+refs/heads/${r}:refs/remotes/origin/${r}`,
        )
        await fetchOriginIfNeeded(cwd, refspecs)
      }

      // Verify that the head ref exists on remote
      const headExists = await gitExec(
        terminal,
        ['rev-parse', '--verify', `origin/${head}`],
        { timeout: 5000 },
      )
        .then(() => true)
        .catch(() => false)

      if (!headExists) {
        return { commits: [], noRemote: true }
      }

      const gitFormat = '--format=%H|%s|%an|%aI'
      const result = await gitExec(
        terminal,
        ['log', gitFormat, `origin/${base}..origin/${head}`],
        { timeout: 15000 },
      )

      const commits = result.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, message, author, date] = line.split('|')
          return { hash, message, author, date }
        })

      return { commits, noRemote: false }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to get commits'
      return reply.status(400).send({ error: errorMessage })
    }
  })

  // Get paginated commits for a branch
  fastify.get<{
    Params: TerminalParams
    Querystring: { branch: string; limit?: string; offset?: string }
  }>('/api/terminals/:id/branch-commits', async (request, reply) => {
    const terminal = await resolveTerminal(request.params)

    const { branch } = request.query
    if (!branch) {
      return reply.status(400).send({ error: 'branch is required' })
    }

    const limit = Math.min(parseInt(request.query.limit || '20', 10) || 20, 100)
    const offset = parseInt(request.query.offset || '0', 10) || 0

    try {
      const gitFormat = '--format=%H|%s|%an|%aI'
      const result = await gitExec(
        terminal,
        [
          'log',
          gitFormat,
          `--max-count=${limit + 1}`,
          `--skip=${offset}`,
          branch,
        ],
        { timeout: 15000 },
      )

      const lines = result.stdout.trim().split('\n').filter(Boolean)
      const hasMore = lines.length > limit
      const commits = lines.slice(0, limit).map((line) => {
        const [hash, message, author, date] = line.split('|')
        return { hash, message, author, date }
      })

      // Find merge-base with default branch (only on first page)
      let mergeBase: string | undefined
      let mergeBaseBranch: string | undefined
      if (offset === 0) {
        for (const defaultBranch of ['main', 'master']) {
          try {
            const mb = await gitExec(
              terminal,
              ['merge-base', defaultBranch, branch],
              { timeout: 5000 },
            )
            mergeBase = mb.stdout.trim()
            mergeBaseBranch = defaultBranch
            break
          } catch {
            // branch doesn't exist, try next
          }
        }
      }

      return { commits, hasMore, mergeBase, mergeBaseBranch }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to get branch commits'
      return reply.status(400).send({ error: errorMessage })
    }
  })
}
