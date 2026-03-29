import fs from 'node:fs'
import path from 'node:path'
import {
  branchCommitsInput,
  changedFilesInput,
  fileContentsInput,
  fileDiffInput,
  headBaseInput,
  terminalIdInput,
} from '@domains/git/schema'
import {
  fetchOriginIfNeeded,
  parseChangedFiles,
} from '@domains/git/services/git-utils'
import { resolveGitTerminal } from '@domains/git/services/resolve'
import { getTerminalById } from '@domains/workspace/db/terminals'
import { gitExecLogged } from '@server/lib/git'
import { expandPath } from '@server/lib/strings'
import { publicProcedure } from '@server/trpc'

export const headMessage = publicProcedure
  .input(terminalIdInput)
  .query(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    const result = await gitExecLogged(terminal, ['log', '-1', '--format=%B'], {
      terminalId: input.terminalId,
      errorOnly: true,
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
          await gitExecLogged(terminal, [], {
            terminalId: input.terminalId,
            errorOnly: true,
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
        gitExecLogged(terminal, ['diff', '--numstat', base], {
          terminalId: input.terminalId,
          errorOnly: true,
          timeout: 10000,
        }).then(
          (r) => r.stdout,
          () => '',
        ),
        gitExecLogged(terminal, ['diff', '--name-status', base], {
          terminalId: input.terminalId,
          errorOnly: true,
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
      gitExecLogged(terminal, args, {
        terminalId: input.terminalId,
        errorOnly: true,
        timeout: 10000,
        sshCmd,
      }).then(
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
      gitExecLogged(terminal, args, {
        terminalId: input.terminalId,
        errorOnly: true,
        timeout: 10000,
        ...extraOpts,
      }).then(
        (r) => r.stdout,
        (err) => {
          // git diff --no-index exits with code 1 when differences exist,
          // but stdout still contains the diff output
          if (err && typeof err === 'object' && 'stdout' in err) {
            return String(err.stdout)
          }
          return ''
        },
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

function extToMonacoLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    mdx: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    dockerfile: 'dockerfile',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    toml: 'ini',
    ini: 'ini',
    lua: 'lua',
    r: 'r',
  }
  return map[ext] || 'plaintext'
}

export const fileContents = publicProcedure
  .input(fileContentsInput)
  .query(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const filePath = input.path
    const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

    const safe = (
      args: string[],
      extraOpts?: { maxBuffer?: number; sshCmd?: string },
    ) =>
      gitExecLogged(terminal, args, {
        terminalId: input.terminalId,
        errorOnly: true,
        timeout: 10000,
        ...extraOpts,
      }).then(
        (r) => r.stdout,
        () => '',
      )

    // Detect binary via numstat
    if (input.base) {
      const numstat = await safe([
        'diff',
        '--numstat',
        input.base,
        '--',
        filePath,
      ])
      if (numstat.startsWith('-\t-\t')) {
        return {
          original: '',
          modified: '',
          language: 'plaintext',
          binary: true,
        }
      }
    } else {
      const numstat = await safe(['diff', '--numstat', 'HEAD', '--', filePath])
      if (numstat.startsWith('-\t-\t')) {
        return {
          original: '',
          modified: '',
          language: 'plaintext',
          binary: true,
        }
      }
    }

    // Get original content
    let originalRef = 'HEAD'
    if (input.base) {
      const parts = input.base.includes('...')
        ? input.base.split('...')
        : input.base.split('..')
      originalRef = parts[0]
    }
    const original = await safe(['show', `${originalRef}:${filePath}`], {
      maxBuffer: 10 * 1024 * 1024,
    })

    // Get modified content
    let modified: string
    if (input.base) {
      const parts = input.base.includes('...')
        ? input.base.split('...')
        : input.base.split('..')
      const rightRef = parts.length > 1 ? parts[1] : parts[0]
      modified = await safe(['show', `${rightRef}:${filePath}`], {
        maxBuffer: 10 * 1024 * 1024,
      })
    } else if (terminal.ssh_host) {
      modified = await safe([], {
        sshCmd: `cat '${filePath}'`,
        maxBuffer: 10 * 1024 * 1024,
      })
    } else {
      const fullPath = path.join(cwd, filePath)
      modified = await fs.promises.readFile(fullPath, 'utf-8').catch(() => '')
    }

    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const language = extToMonacoLanguage(ext)

    return { original, modified, language, binary: false }
  })

export const commits = publicProcedure
  .input(headBaseInput)
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

    const headExists = await gitExecLogged(
      terminal,
      ['rev-parse', '--verify', `origin/${input.head}`],
      { terminalId: input.terminalId, errorOnly: true, timeout: 5000 },
    )
      .then(() => true)
      .catch(() => false)

    if (!headExists) {
      return {
        commits: [] as {
          hash: string
          message: string
          body: string
          author: string
          date: string
        }[],
        noRemote: true,
      }
    }

    const result = await gitExecLogged(
      terminal,
      [
        'log',
        '--format=%H%x00%s%x00%B%x00%an%x00%aI%x01',
        `origin/${input.base}..origin/${input.head}`,
      ],
      { terminalId: input.terminalId, errorOnly: true, timeout: 15000 },
    )

    const commitList = result.stdout
      .trim()
      .split('\x01')
      .filter(Boolean)
      .map((record) => {
        const [hash, message, body, author, date] = record.trim().split('\x00')
        return { hash, message, body: body.trim(), author, date }
      })

    return { commits: commitList, noRemote: false }
  })

export const branchCommits = publicProcedure
  .input(branchCommitsInput)
  .query(async ({ input }) => {
    const terminal = await getTerminalById(input.terminalId)
    if (!terminal) throw new Error('Terminal not found')

    const logArgs = [
      'log',
      '--format=%H%x00%s%x00%B%x00%an%x00%aI%x01',
      `--max-count=${input.limit + 1}`,
      `--skip=${input.offset}`,
    ]

    if (input.search) {
      logArgs.push(`--grep=${input.search}`, '-i')
    }

    logArgs.push(input.branch)

    const result = await gitExecLogged(terminal, logArgs, {
      terminalId: input.terminalId,
      errorOnly: true,
      timeout: 15000,
    })

    const records = result.stdout.trim().split('\x01').filter(Boolean)
    const hasMore = records.length > input.limit

    function parseRecord(record: string) {
      const [hash, message, body, author, date] = record.trim().split('\x00')
      return { hash, message, body: body.trim(), author, date }
    }

    const commitList = records.slice(0, input.limit).map(parseRecord)

    // If search looks like a hex hash prefix, try to resolve it and prepend
    if (
      input.search &&
      /^[0-9a-f]{4,}$/i.test(input.search) &&
      input.offset === 0
    ) {
      try {
        const resolved = await gitExecLogged(
          terminal,
          ['log', '-1', '--format=%H%x00%s%x00%B%x00%an%x00%aI', input.search],
          { terminalId: input.terminalId, errorOnly: true, timeout: 5000 },
        )
        const parsed = parseRecord(resolved.stdout.trim())
        if (parsed.hash && !commitList.some((c) => c.hash === parsed.hash)) {
          // Verify it's on the branch
          const onBranch = await gitExecLogged(
            terminal,
            ['branch', '--contains', parsed.hash, '--list', input.branch],
            { terminalId: input.terminalId, errorOnly: true, timeout: 5000 },
          )
            .then((r) => r.stdout.trim().length > 0)
            .catch(() => false)
          if (onBranch) {
            commitList.unshift(parsed)
          }
        }
      } catch {
        // not a valid hash, ignore
      }
    }

    // Find merge-base with default branch (only on first page, skip when searching)
    let mergeBase: string | undefined
    let mergeBaseBranch: string | undefined
    if (input.offset === 0 && !input.search) {
      for (const defaultBranch of ['main', 'master']) {
        try {
          const mb = await gitExecLogged(
            terminal,
            ['merge-base', defaultBranch, input.branch],
            { terminalId: input.terminalId, errorOnly: true, timeout: 5000 },
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
  .input(headBaseInput)
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

    const hasConflicts = await gitExecLogged(
      terminal,
      [
        'merge-tree',
        '--write-tree',
        '--no-messages',
        `origin/${input.base}`,
        `origin/${input.head}`,
      ],
      { terminalId: input.terminalId, errorOnly: true, timeout: 15000 },
    )
      .then(() => false)
      .catch(() => true)

    return { hasConflicts }
  })
