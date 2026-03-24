import { getTerminalById } from '@domains/workspace/db/terminals'
import { gitExec } from '@server/lib/git'
import { expandPath } from '@server/lib/strings'
import { publicProcedure } from '@server/trpc/init'
import { resolveGitTerminal } from '../resolve'
import {
  branchCommitsInput,
  branchConflictsInput,
  changedFilesInput,
  commitsInput,
  fileDiffInput,
  terminalIdInput,
} from '../schema'
import { fetchOriginIfNeeded, parseChangedFiles } from '../services/git-utils'

export const headMessage = publicProcedure
  .input(terminalIdInput)
  .query(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    const result = await gitExec(terminal, ['log', '-1', '--format=%B'], {
      timeout: 10000,
    })

    return { message: result.stdout.trim() }
  })

export const changedFiles = publicProcedure
  .input(changedFilesInput)
  .query(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)
    const base = input.base

    // When base is provided, diff between two refs (for PR view)
    if (base) {
      const parts = base.split('...')
      const refs = parts
        .map((p) => p.replace(/^origin\//, '').replace(/\^$/, ''))
        .filter((r) => !/^[0-9a-f]{6,}$/i.test(r))
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

    return {
      files: parseChangedFiles(
        numstatOut,
        nameStatusOut,
        untrackedOut,
        untrackedWcOut,
      ),
    }
  })

export const fileDiff = publicProcedure
  .input(fileDiffInput)
  .query(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const filePath = input.path
    const context = input.context || '5'

    const safe = (
      args: string[],
      extraOpts?: { maxBuffer?: number; sshCmd?: string },
    ) =>
      gitExec(terminal, args, { timeout: 10000, ...extraOpts }).then(
        (r) => r.stdout,
        () => '',
      )

    if (input.base) {
      const args = ['diff', `-U${context}`, input.base]
      if (filePath) args.push('--', filePath)
      const diff = await safe(args, { maxBuffer: 10 * 1024 * 1024 })
      return { diff }
    }

    if (filePath) {
      let diff = await safe(['diff', `-U${context}`, 'HEAD', '--', filePath])
      if (!diff) {
        diff = await safe(['diff', `-U${context}`, '--', filePath])
      }
      if (!diff.trim()) {
        diff = await safe(['diff', '--no-index', '--', '/dev/null', filePath])
      }
      return { diff }
    }

    // Full diff (all files)
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
        const part = await safe(['diff', '--no-index', '--', '/dev/null', file])
        if (part) untrackedParts.push(part)
      }
      if (untrackedParts.length > 0) {
        diff = `${diff}\n${untrackedParts.join('\n')}`
      }
    }

    return { diff }
  })

export const commits = publicProcedure
  .input(commitsInput)
  .query(async ({ input }) => {
    const terminal = await getTerminalById(input.terminalId)
    if (!terminal) throw new Error('Terminal not found')

    const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

    if (!terminal.ssh_host) {
      const refspecs = [input.head, input.base].map(
        (r) => `+refs/heads/${r}:refs/remotes/origin/${r}`,
      )
      await fetchOriginIfNeeded(cwd, refspecs)
    }

    const headExists = await gitExec(
      terminal,
      ['rev-parse', '--verify', `origin/${input.head}`],
      { timeout: 5000 },
    )
      .then(() => true)
      .catch(() => false)

    if (!headExists) {
      return {
        commits: [] as {
          hash: string
          message: string
          author: string
          date: string
        }[],
        noRemote: true,
      }
    }

    const result = await gitExec(
      terminal,
      [
        'log',
        '--format=%H|%s|%an|%aI',
        `origin/${input.base}..origin/${input.head}`,
      ],
      { timeout: 15000 },
    )

    const commitList = result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, message, author, date] = line.split('|')
        return { hash, message, author, date }
      })

    return { commits: commitList, noRemote: false }
  })

export const branchCommits = publicProcedure
  .input(branchCommitsInput)
  .query(async ({ input }) => {
    const terminal = await getTerminalById(input.terminalId)
    if (!terminal) throw new Error('Terminal not found')

    const result = await gitExec(
      terminal,
      [
        'log',
        '--format=%H|%s|%an|%aI',
        `--max-count=${input.limit + 1}`,
        `--skip=${input.offset}`,
        input.branch,
      ],
      { timeout: 15000 },
    )

    const lines = result.stdout.trim().split('\n').filter(Boolean)
    const hasMore = lines.length > input.limit
    const commitList = lines.slice(0, input.limit).map((line) => {
      const [hash, message, author, date] = line.split('|')
      return { hash, message, author, date }
    })

    // Find merge-base with default branch (only on first page)
    let mergeBase: string | undefined
    let mergeBaseBranch: string | undefined
    if (input.offset === 0) {
      for (const defaultBranch of ['main', 'master']) {
        try {
          const mb = await gitExec(
            terminal,
            ['merge-base', defaultBranch, input.branch],
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

    return { commits: commitList, hasMore, mergeBase, mergeBaseBranch }
  })

export const branchConflicts = publicProcedure
  .input(branchConflictsInput)
  .query(async ({ input }) => {
    const terminal = await getTerminalById(input.terminalId)
    if (!terminal) throw new Error('Terminal not found')

    const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

    if (!terminal.ssh_host) {
      const refspecs = [input.head, input.base].map(
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
        `origin/${input.base}`,
        `origin/${input.head}`,
      ],
      { timeout: 15000 },
    )
      .then(() => false)
      .catch(() => true)

    return { hasConflicts }
  })
