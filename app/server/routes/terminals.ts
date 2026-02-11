import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'

// Walk up the process tree to find the parent macOS .app (e.g. Terminal, iTerm2, VS Code)
async function getParentAppName(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    let pid = process.ppid
    while (pid > 1) {
      const comm = await new Promise<string>((resolve, reject) => {
        execFile(
          'ps',
          ['-o', 'comm=', '-p', String(pid)],
          { encoding: 'utf-8' },
          (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout.trim())
          },
        )
      })
      const match = comm.match(/\/([^/]+)\.app\//)
      if (match) return match[1]
      const ppidStr = await new Promise<string>((resolve, reject) => {
        execFile(
          'ps',
          ['-o', 'ppid=', '-p', String(pid)],
          { encoding: 'utf-8' },
          (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout.trim())
          },
        )
      })
      pid = Number.parseInt(ppidStr, 10)
      if (Number.isNaN(pid)) break
    }
  } catch {}
  return null
}

// Lazily cached parent app name
let parentAppNamePromise: Promise<string | null> | null = null
function getParentAppNameCached(): Promise<string | null> {
  if (!parentAppNamePromise) {
    parentAppNamePromise = getParentAppName()
  }
  return parentAppNamePromise
}

// Expand ~ to home directory
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2))
  }
  if (p === '~') {
    return os.homedir()
  }
  return p
}

function parseChangedFiles(
  numstatOut: string,
  nameStatusOut: string,
  untrackedOut: string,
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
  for (const line of untrackedOut.trim().split('\n')) {
    if (!line) continue
    // Skip if already present from diff
    if (!statusMap.has(line)) {
      files.push({ path: line, status: 'untracked', added: 0, removed: 0 })
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

import {
  createTerminal,
  deleteTerminal,
  getAllTerminals,
  getTerminalById,
  logCommand,
  terminalNameExists,
  updateTerminal,
} from '../db'
import { refreshPRChecks, trackTerminal } from '../github/checks'
import { log } from '../logger'
import {
  checkAndEmitSingleGitDirty,
  destroySession,
  detectGitBranch,
} from '../pty/manager'
import { listSSHHosts, validateSSHHost } from '../ssh/config'
import { execSSHCommand } from '../ssh/exec'
import {
  deleteTerminalWorkspace,
  emitWorkspace,
  rmrf,
  setupTerminalWorkspace,
} from '../workspace/setup'

interface CreateTerminalBody {
  cwd?: string
  name?: string
  shell?: string
  ssh_host?: string
  git_repo?: string
  workspaces_root?: string
  setup_script?: string
  delete_script?: string
  source_terminal_id?: number
}

interface UpdateTerminalBody {
  name?: string
  settings?: { defaultClaudeCommand?: string } | null
}

interface CheckoutBranchBody {
  branch: string
  isRemote: boolean
}

interface PullBranchBody {
  branch: string
}

interface PushBranchBody {
  branch: string
  force?: boolean
}

interface RebaseBranchBody {
  branch: string
}

interface CreateBranchBody {
  name: string
  from: string
}

interface DeleteBranchBody {
  branch: string
  deleteRemote?: boolean
}

interface BranchInfo {
  name: string
  current: boolean
  commitDate: string
}

interface TerminalParams {
  id: string
}

interface ListDirectoriesBody {
  paths: string[]
  page?: number
  hidden?: boolean
  ssh_host?: string
}

interface DirEntry {
  name: string
  isDir: boolean
}

interface DirResult {
  entries?: DirEntry[]
  hasMore?: boolean
  error?: string | null
}

const PAGE_SIZE = 100

export default async function terminalRoutes(fastify: FastifyInstance) {
  // Open native OS folder picker and return selected path
  fastify.get('/api/browse-folder', async (_request, reply) => {
    return new Promise<void>((resolve) => {
      execFile(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "Select a folder")'],
        { timeout: 60000 },
        (err, stdout) => {
          if (err) {
            // User cancelled or error
            reply.status(204).send()
          } else {
            const folder = stdout.trim().replace(/\/$/, '')
            reply.send({ path: folder })
          }
          resolve()
        },
      )
    })
  })

  // Open macOS System Settings to Full Disk Access
  fastify.post('/api/open-full-disk-access', async (_request, reply) => {
    if (process.platform !== 'darwin') {
      return reply.status(404).send()
    }
    return new Promise<void>((resolve) => {
      execFile(
        'open',
        [
          'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
        ],
        (err) => {
          if (err) {
            reply.status(500).send({ error: 'Failed to open System Settings' })
          } else {
            reply.status(204).send()
          }
          resolve()
        },
      )
    })
  })

  // Open directory or file in IDE (Cursor or VS Code) via CLI
  fastify.post<{
    Body: {
      path: string
      ide: 'cursor' | 'vscode'
      terminal_id?: number
    }
  }>('/api/open-in-ide', async (request, reply) => {
    const { path: rawPath, ide, terminal_id } = request.body
    if (!rawPath) {
      return reply.status(400).send({ error: 'Path is required' })
    }

    const cmd = ide === 'vscode' ? 'code' : 'cursor'

    // Strip :line:col suffix for existence check (IDE CLIs handle file:line:col)
    const lineColMatch = rawPath.match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/)
    const pathOnly = lineColMatch ? lineColMatch[1] : rawPath

    // Resolve path against terminal cwd if terminal_id is provided
    let resolvedPath = pathOnly
    if (terminal_id != null) {
      const terminal = await getTerminalById(terminal_id)
      if (terminal) {
        // Resolve relative paths against terminal's cwd
        if (!pathOnly.startsWith('/') && !pathOnly.startsWith('~')) {
          resolvedPath = `${terminal.cwd}/${pathOnly}`
        }
      }
    }

    // Check file existence
    try {
      await fs.promises.access(expandPath(resolvedPath))
    } catch {
      return reply.status(404).send({ error: 'File not found' })
    }

    // Build full target path with :line:col for the IDE CLI
    const targetPath = expandPath(
      lineColMatch?.[2]
        ? `${resolvedPath}:${lineColMatch[2]}${lineColMatch[3] ? `:${lineColMatch[3]}` : ''}`
        : resolvedPath,
    )

    return new Promise<void>((resolve) => {
      execFile(cmd, ['--goto', targetPath], { timeout: 5000 }, (err) => {
        if (err) {
          reply
            .status(500)
            .send({ error: `Failed to open ${cmd}: ${err.message}` })
        } else {
          reply.status(204).send()
        }
        resolve()
      })
    })
  })

  // Open directory in native file explorer (Finder on macOS, xdg-open on Linux)
  fastify.post<{ Body: { path: string } }>(
    '/api/open-in-explorer',
    async (request, reply) => {
      const { path: rawPath } = request.body
      if (!rawPath) {
        return reply.status(400).send({ error: 'Path is required' })
      }

      const targetPath = expandPath(rawPath)
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'

      return new Promise<void>((resolve) => {
        execFile(cmd, [targetPath], (err) => {
          if (err) {
            reply.status(500).send({ error: 'Failed to open file explorer' })
          } else {
            reply.status(204).send()
          }
          resolve()
        })
      })
    },
  )

  // List directory contents for the column browser
  fastify.post<{ Body: ListDirectoriesBody }>(
    '/api/list-directories',
    async (request) => {
      const { paths, page = 0, hidden = false, ssh_host } = request.body
      const results: Record<string, DirResult> = {}

      // Validate SSH host if provided
      if (ssh_host) {
        const validation = validateSSHHost(ssh_host)
        if (!validation.valid) {
          return {
            results: Object.fromEntries(
              paths.map((p) => [p, { error: validation.error }]),
            ),
          }
        }
      }

      await Promise.all(
        paths.map(async (rawPath) => {
          try {
            if (ssh_host) {
              // Remote directory listing via SSH
              // Use ls -1 -p to get entries with / suffix on directories
              const flags = hidden ? '-1ap' : '-1p'
              const { stdout } = await execSSHCommand(
                ssh_host,
                `ls ${flags} ${rawPath.replace(/'/g, "'\\''")}`,
              )
              const lines = stdout
                .split('\n')
                .filter((l) => l && l !== './' && l !== '../')

              const allEntries: DirEntry[] = lines.map((line) => {
                const isDir = line.endsWith('/')
                return {
                  name: isDir ? line.slice(0, -1) : line,
                  isDir,
                }
              })

              // Sort: directories first, then files, alphabetical within each
              allEntries.sort((a, b) => {
                const aDir = a.isDir ? 0 : 1
                const bDir = b.isDir ? 0 : 1
                if (aDir !== bDir) return aDir - bDir
                return a.name.localeCompare(b.name)
              })

              const start = page * PAGE_SIZE
              const paged = allEntries.slice(start, start + PAGE_SIZE)
              const hasMore = start + PAGE_SIZE < allEntries.length

              results[rawPath] = { entries: paged, hasMore, error: null }
            } else {
              // Local directory listing
              const dirPath = expandPath(rawPath)
              const entries = await fs.promises.readdir(dirPath, {
                withFileTypes: true,
              })

              const filtered = entries.filter((e) => {
                if (!hidden && e.name.startsWith('.')) return false
                return true
              })

              // Sort: directories first, then files, alphabetical within each
              filtered.sort((a, b) => {
                const aDir = a.isDirectory() ? 0 : 1
                const bDir = b.isDirectory() ? 0 : 1
                if (aDir !== bDir) return aDir - bDir
                return a.name.localeCompare(b.name)
              })

              const start = page * PAGE_SIZE
              const paged = filtered.slice(start, start + PAGE_SIZE)
              const hasMore = start + PAGE_SIZE < filtered.length

              results[rawPath] = {
                entries: paged.map((e) => ({
                  name: e.name,
                  isDir: e.isDirectory(),
                })),
                hasMore,
                error: null,
              }
            }
          } catch (err) {
            const isPermissionError =
              err instanceof Error &&
              (err as NodeJS.ErrnoException).code === 'EPERM'
            const appName = isPermissionError
              ? await getParentAppNameCached()
              : null
            results[rawPath] = {
              error: isPermissionError
                ? `permission_denied:${appName ?? ''}`
                : err instanceof Error
                  ? err.message
                  : 'Failed to list directory',
            }
          }
        }),
      )

      return { results }
    },
  )

  // List available SSH hosts from ~/.ssh/config
  fastify.get('/api/ssh/hosts', async () => {
    return listSSHHosts()
  })

  // List all terminals
  fastify.get('/api/terminals', async () => {
    const terminals = await getAllTerminals()
    return terminals.map((terminal) => {
      // Don't mark as orphaned if it's being set up (directory doesn't exist yet)
      const isSettingUp =
        terminal.git_repo?.status === 'setup' ||
        terminal.setup?.status === 'setup'
      return {
        ...terminal,
        orphaned:
          terminal.ssh_host || isSettingUp
            ? false
            : !fs.existsSync(terminal.cwd),
      }
    })
  })

  // Create terminal
  fastify.post<{ Body: CreateTerminalBody }>(
    '/api/terminals',
    async (request, reply) => {
      const {
        cwd: rawCwd,
        name,
        shell,
        ssh_host,
        git_repo,
        workspaces_root,
        setup_script,
        delete_script,
        source_terminal_id,
      } = request.body

      // --- Worktree mode (Add Workspace from existing terminal) ---
      if (source_terminal_id) {
        const sourceTerminal = await getTerminalById(source_terminal_id)
        if (!sourceTerminal?.git_repo) {
          return reply
            .status(400)
            .send({ error: 'Source terminal has no git repo' })
        }

        const repo = sourceTerminal.git_repo.repo
        // Build setup object from source terminal's setup (with status reset)
        let setupObj: Record<string, unknown> | null = null
        if (sourceTerminal.setup) {
          const { status: _, error: _e, ...rest } = sourceTerminal.setup
          setupObj = { ...rest, status: 'setup' as const }
        }

        const gitRepoData: Record<string, unknown> = {
          repo,
          status: 'setup' as const,
        }
        if (sourceTerminal.git_repo.workspaces_root) {
          gitRepoData.workspaces_root = sourceTerminal.git_repo.workspaces_root
        }

        const terminal = await createTerminal(
          '~',
          name?.trim() || repo.split('/').pop()!,
          sourceTerminal.shell,
          sourceTerminal.ssh_host,
          gitRepoData,
          setupObj,
          sourceTerminal.settings,
        )

        setupTerminalWorkspace({
          terminalId: terminal.id,
          repo,
          setupObj: setupObj as {
            conductor?: boolean
            setup?: string
            delete?: string
          } | null,
          workspacesRoot: sourceTerminal.git_repo.workspaces_root || undefined,
          worktreeSource: sourceTerminal.cwd,
          customName: !!name?.trim(),
          sshHost: sourceTerminal.ssh_host,
        }).catch((err) =>
          log.error(
            `[terminals] Workspace setup error: ${err instanceof Error ? err.message : err}`,
          ),
        )

        trackTerminal(terminal.id).then(() => refreshPRChecks(true))
        return reply.status(201).send(terminal)
      }

      if (git_repo) {
        // --- Git repo workspace creation (local or SSH) ---
        const repo = git_repo.trim()
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
          return reply
            .status(400)
            .send({ error: 'git_repo must be in owner/repo format' })
        }

        // Validate SSH host if provided alongside git repo
        let trimmedHost: string | null = null
        if (ssh_host) {
          trimmedHost = ssh_host.trim()
          if (trimmedHost) {
            const result = validateSSHHost(trimmedHost)
            if (!result.valid) {
              return reply.status(400).send({ error: result.error })
            }
          }
        }

        // Build setup object
        const hasSetup = setup_script || delete_script
        const setupObj = hasSetup
          ? {
              ...(setup_script?.trim() ? { setup: setup_script.trim() } : {}),
              ...(delete_script?.trim()
                ? { delete: delete_script.trim() }
                : {}),
              status: 'setup' as const,
            }
          : null

        const gitRepoData: Record<string, unknown> = {
          repo,
          status: 'setup' as const,
        }
        if (workspaces_root?.trim()) {
          gitRepoData.workspaces_root = workspaces_root.trim()
        }

        // cwd is a placeholder — setupTerminalWorkspace will update it to the clone target
        const terminal = await createTerminal(
          '~',
          name?.trim() || repo.split('/').pop()!,
          shell?.trim() || null,
          trimmedHost,
          gitRepoData,
          setupObj,
        )

        // Fire-and-forget: setup workspace async
        setupTerminalWorkspace({
          terminalId: terminal.id,
          repo,
          setupObj: setupObj as {
            conductor?: boolean
            setup?: string
            delete?: string
          } | null,
          workspacesRoot: workspaces_root?.trim() || undefined,
          customName: !!name?.trim(),
          sshHost: trimmedHost,
        }).catch((err) =>
          log.error(
            `[terminals] Workspace setup error: ${err instanceof Error ? err.message : err}`,
          ),
        )
        trackTerminal(terminal.id).then(() => refreshPRChecks(true))
        return reply.status(201).send(terminal)
      }

      if (ssh_host) {
        // --- SSH terminal creation (without git repo) ---
        const trimmedHost = ssh_host.trim()
        if (!trimmedHost) {
          return reply.status(400).send({ error: 'ssh_host cannot be empty' })
        }

        const result = validateSSHHost(trimmedHost)
        if (!result.valid) {
          return reply.status(400).send({ error: result.error })
        }

        const terminal = await createTerminal(
          rawCwd?.trim() || '~',
          name?.trim() || trimmedHost,
          null,
          trimmedHost,
        )
        trackTerminal(terminal.id).then(() => refreshPRChecks(true))
        return reply.status(201).send(terminal)
      }

      // --- Local terminal creation ---
      if (!rawCwd) {
        return reply.status(400).send({ error: 'cwd is required' })
      }

      // Expand ~ to home directory
      const cwd = expandPath(rawCwd.trim())

      try {
        const stat = await fs.promises.stat(cwd)
        if (!stat.isDirectory()) {
          return reply.status(400).send({ error: 'Path is not a directory' })
        }
      } catch {
        return reply.status(400).send({ error: 'Directory does not exist' })
      }

      // Check read and execute permissions (needed to cd into and list directory)
      try {
        await fs.promises.access(cwd, fs.constants.R_OK | fs.constants.X_OK)
      } catch {
        return reply
          .status(403)
          .send({ error: 'Permission denied: cannot access directory' })
      }

      const terminal = await createTerminal(cwd, name || null, shell || null)
      trackTerminal(terminal.id).then(() => refreshPRChecks(true))
      return reply.status(201).send(terminal)
    },
  )

  // Get single terminal
  fastify.get<{ Params: TerminalParams }>(
    '/api/terminals/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }
      return terminal
    },
  )

  // Update terminal
  fastify.patch<{ Params: TerminalParams; Body: UpdateTerminalBody }>(
    '/api/terminals/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      // Check for duplicate name on rename
      if (
        request.body.name !== undefined &&
        (await terminalNameExists(request.body.name, id))
      ) {
        return reply
          .status(409)
          .send({ error: 'A terminal with this name already exists' })
      }

      const updated = await updateTerminal(id, request.body)
      return updated
    },
  )

  // Delete terminal
  fastify.delete<{
    Params: TerminalParams
    Querystring: { deleteDirectory?: string }
  }>('/api/terminals/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10)
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid terminal id' })
    }

    const terminal = await getTerminalById(id)
    if (!terminal) {
      return reply.status(404).send({ error: 'Terminal not found' })
    }

    const deleteDirectory = !!request.query.deleteDirectory

    // Setup with delete script or conductor: run delete script async, then delete
    // Don't destroy session — teardown script will run in it
    const hasDeleteFlow =
      deleteDirectory &&
      terminal.setup &&
      terminal.setup.status !== 'failed' &&
      (terminal.setup.conductor || terminal.setup.delete) &&
      terminal.git_repo?.status === 'done'
    if (hasDeleteFlow) {
      const deleteSetup = { ...terminal.setup, status: 'delete' as const }
      await updateTerminal(id, { setup: deleteSetup })
      emitWorkspace(id, { setup: deleteSetup })
      deleteTerminalWorkspace(id).catch((err) =>
        log.error(
          `[terminals] Delete workspace error: ${err instanceof Error ? err.message : err}`,
        ),
      )
      refreshPRChecks(true)
      return reply.status(202).send()
    }

    // Kill PTY session for non-delete-flow paths
    const killed = destroySession(id)
    if (killed) {
      log.info(`[terminals] Killed PTY session for terminal ${id}`)
    }

    // Delete workspace directory if requested
    if (deleteDirectory && terminal.git_repo) {
      try {
        await rmrf(
          terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd),
          terminal.ssh_host ?? null,
        )
      } catch {
        // Directory may not exist if clone failed
      }
    }

    await deleteTerminal(id)
    refreshPRChecks(true)
    return reply.status(204).send()
  })

  // Get branches for a terminal
  fastify.get<{ Params: TerminalParams }>(
    '/api/terminals/:id/branches',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const gitCmd = `git for-each-ref --sort=-committerdate --format='%(refname:short)|%(HEAD)|%(committerdate:iso8601)' refs/heads refs/remotes/origin`

      try {
        let stdout: string
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, gitCmd, {
            cwd: terminal.cwd,
          })
          stdout = result.stdout
        } else {
          stdout = await new Promise<string>((resolve, reject) => {
            execFile(
              'git',
              [
                'for-each-ref',
                '--sort=-committerdate',
                '--format=%(refname:short)|%(HEAD)|%(committerdate:iso8601)',
                'refs/heads',
                'refs/remotes/origin',
              ],
              { cwd: expandPath(terminal.cwd), timeout: 10000 },
              (err, out) => {
                if (err) reject(err)
                else resolve(out)
              },
            )
          })
        }

        let currentBranch: BranchInfo | null = null
        const local: BranchInfo[] = []
        const remote: BranchInfo[] = []

        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue
          const [name, head, commitDate] = line.split('|')

          // Skip origin/HEAD and origin (the remote ref itself)
          if (name === 'origin/HEAD' || name === 'origin') continue

          const isCurrent = head === '*'

          if (name.startsWith('origin/')) {
            // Remote branch - strip origin/ prefix
            const branchName = name.slice(7)
            if (remote.length < 50) {
              remote.push({ name: branchName, current: false, commitDate })
            }
          } else {
            // Local branch - track current separately to put it first
            if (isCurrent) {
              currentBranch = { name, current: true, commitDate }
            } else if (local.length < 49) {
              local.push({ name, current: false, commitDate })
            }
          }
        }

        // Prepend current branch to local list
        if (currentBranch) {
          local.unshift(currentBranch)
        }

        return { local, remote }
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Failed to list branches',
        })
      }
    },
  )

  // Checkout a branch
  fastify.post<{ Params: TerminalParams; Body: CheckoutBranchBody }>(
    '/api/terminals/:id/checkout',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const { branch } = request.body
      if (!branch) {
        return reply.status(400).send({ error: 'Branch is required' })
      }

      const gitCmd = `git checkout ${branch.replace(/'/g, "'\\''")}`

      try {
        const cwd = expandPath(terminal.cwd)

        if (terminal.ssh_host) {
          // Prune stale worktrees before checkout
          await execSSHCommand(terminal.ssh_host, 'git worktree prune', {
            cwd: terminal.cwd,
          }).catch(() => {})

          const result = await execSSHCommand(terminal.ssh_host, gitCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: gitCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          // Prune stale worktrees before checkout
          await new Promise<void>((resolve) => {
            execFile('git', ['worktree', 'prune'], { cwd, timeout: 5000 }, () =>
              resolve(),
            )
          })

          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['checkout', branch],
              { cwd, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: gitCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                  failed: !!err,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }

        // Refresh git branch detection and PR checks
        detectGitBranch(id).catch(() => {})

        return { success: true, branch }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to checkout branch'
        return reply.status(400).send({
          success: false,
          branch,
          error: errorMessage,
        })
      }
    },
  )

  // Pull a branch
  fastify.post<{ Params: TerminalParams; Body: PullBranchBody }>(
    '/api/terminals/:id/pull',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const { branch } = request.body
      if (!branch) {
        return reply.status(400).send({ error: 'Branch is required' })
      }

      try {
        // Check current branch to determine the right strategy
        const currentBranch = terminal.git_branch || ''
        const isOnTargetBranch = currentBranch === branch

        if (isOnTargetBranch) {
          // On target branch: pull with rebase
          const pullCmd = `git pull --rebase origin ${branch.replace(/'/g, "'\\''")}`
          if (terminal.ssh_host) {
            const result = await execSSHCommand(terminal.ssh_host, pullCmd, {
              cwd: terminal.cwd,
            })
            logCommand({
              terminalId: id,
              category: 'git',
              command: pullCmd,
              stdout: result.stdout,
              stderr: result.stderr,
            })
          } else {
            await new Promise<void>((resolve, reject) => {
              execFile(
                'git',
                ['pull', '--rebase', 'origin', branch],
                { cwd: expandPath(terminal.cwd), timeout: 60000 },
                (err, stdout, stderr) => {
                  logCommand({
                    terminalId: id,
                    category: 'git',
                    command: pullCmd,
                    stdout,
                    stderr: err ? err.message : stderr,
                  })
                  if (err) reject(err)
                  else resolve()
                },
              )
            })
          }
        } else {
          // On different branch: fetch and fast-forward update the target branch
          // This fails if branches have diverged (which requires manual resolution)
          const fetchCmd = `git fetch origin ${branch.replace(/'/g, "'\\''")}:${branch.replace(/'/g, "'\\''")}`
          if (terminal.ssh_host) {
            const result = await execSSHCommand(terminal.ssh_host, fetchCmd, {
              cwd: terminal.cwd,
            })
            logCommand({
              terminalId: id,
              category: 'git',
              command: fetchCmd,
              stdout: result.stdout,
              stderr: result.stderr,
            })
          } else {
            await new Promise<void>((resolve, reject) => {
              execFile(
                'git',
                ['fetch', 'origin', `${branch}:${branch}`],
                { cwd: expandPath(terminal.cwd), timeout: 60000 },
                (err, stdout, stderr) => {
                  logCommand({
                    terminalId: id,
                    category: 'git',
                    command: fetchCmd,
                    stdout,
                    stderr: err ? err.message : stderr,
                  })
                  if (err) reject(err)
                  else resolve()
                },
              )
            })
          }
        }

        // Refresh git branch detection
        detectGitBranch(id).catch(() => {})

        return { success: true, branch }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to pull branch'
        return reply.status(400).send({
          success: false,
          branch,
          error: errorMessage,
        })
      }
    },
  )

  // Push a branch
  fastify.post<{ Params: TerminalParams; Body: PushBranchBody }>(
    '/api/terminals/:id/push',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const { branch, force } = request.body
      if (!branch) {
        return reply.status(400).send({ error: 'Branch is required' })
      }

      const pushArgs = force
        ? ['push', '--force', 'origin', branch]
        : ['push', 'origin', branch]
      const gitCmd = force
        ? `git push --force origin ${branch.replace(/'/g, "'\\''")}`
        : `git push origin ${branch.replace(/'/g, "'\\''")}`

      try {
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, gitCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: gitCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              pushArgs,
              { cwd: expandPath(terminal.cwd), timeout: 60000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: gitCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                  failed: !!err,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }

        // Refresh git branch detection
        detectGitBranch(id).catch(() => {})

        return { success: true, branch }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to push branch'
        return reply.status(400).send({
          success: false,
          branch,
          error: errorMessage,
        })
      }
    },
  )

  // Get HEAD commit message
  fastify.get<{ Params: TerminalParams }>(
    '/api/terminals/:id/head-message',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      try {
        const gitCmd = 'git log -1 --format=%B'
        let message: string
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, gitCmd, {
            cwd: terminal.cwd,
          })
          message = result.stdout.trim()
        } else {
          message = await new Promise<string>((resolve, reject) => {
            execFile(
              'git',
              ['log', '-1', '--format=%B'],
              { cwd: expandPath(terminal.cwd), timeout: 10000 },
              (err, stdout) => {
                if (err) reject(err)
                else resolve(stdout.trim())
              },
            )
          })
        }

        return { message }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get HEAD message'
        return reply.status(400).send({ error: errorMessage })
      }
    },
  )

  // Get changed files with per-file stats
  fastify.get<{ Params: TerminalParams }>(
    '/api/terminals/:id/changed-files',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      try {
        const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

        if (terminal.ssh_host) {
          const [numstatResult, nameStatusResult, untrackedResult] =
            await Promise.all([
              execSSHCommand(
                terminal.ssh_host,
                'git diff --numstat HEAD 2>/dev/null || git diff --numstat',
                { cwd: terminal.cwd },
              ),
              execSSHCommand(
                terminal.ssh_host,
                'git diff --name-status HEAD 2>/dev/null || git diff --name-status',
                { cwd: terminal.cwd },
              ),
              execSSHCommand(
                terminal.ssh_host,
                'git ls-files --others --exclude-standard',
                { cwd: terminal.cwd },
              ),
            ])

          const files = parseChangedFiles(
            numstatResult.stdout,
            nameStatusResult.stdout,
            untrackedResult.stdout,
          )
          return { files }
        }

        // Local: run 3 git commands in parallel
        const [numstatOut, nameStatusOut, untrackedOut] = await Promise.all([
          new Promise<string>((resolve) => {
            execFile(
              'git',
              ['diff', '--numstat', 'HEAD'],
              { cwd, timeout: 10000 },
              (err, stdout) => {
                if (err) {
                  execFile(
                    'git',
                    ['diff', '--numstat'],
                    { cwd, timeout: 10000 },
                    (_err2, stdout2) => resolve(stdout2 || ''),
                  )
                } else {
                  resolve(stdout)
                }
              },
            )
          }),
          new Promise<string>((resolve) => {
            execFile(
              'git',
              ['diff', '--name-status', 'HEAD'],
              { cwd, timeout: 10000 },
              (err, stdout) => {
                if (err) {
                  execFile(
                    'git',
                    ['diff', '--name-status'],
                    { cwd, timeout: 10000 },
                    (_err2, stdout2) => resolve(stdout2 || ''),
                  )
                } else {
                  resolve(stdout)
                }
              },
            )
          }),
          new Promise<string>((resolve) => {
            execFile(
              'git',
              ['ls-files', '--others', '--exclude-standard'],
              { cwd, timeout: 10000 },
              (_err, stdout) => resolve(stdout || ''),
            )
          }),
        ])

        const files = parseChangedFiles(numstatOut, nameStatusOut, untrackedOut)
        return { files }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get changed files'
        return reply.status(400).send({ error: errorMessage })
      }
    },
  )

  // Get diff for a single file
  fastify.get<{
    Params: TerminalParams
    Querystring: { path: string; context?: string }
  }>('/api/terminals/:id/file-diff', async (request, reply) => {
    const id = parseInt(request.params.id, 10)
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid terminal id' })
    }

    const terminal = await getTerminalById(id)
    if (!terminal) {
      return reply.status(404).send({ error: 'Terminal not found' })
    }

    if (!terminal.git_repo) {
      return reply.status(400).send({ error: 'Terminal has no git repo' })
    }

    const filePath = request.query.path
    if (!filePath) {
      return reply.status(400).send({ error: 'Missing path query parameter' })
    }

    const context = request.query.context || '5'
    const cwd = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

    try {
      if (terminal.ssh_host) {
        // SSH: try tracked file diff first, then untracked
        const escapedPath = filePath.replace(/'/g, "'\\''")
        let result = await execSSHCommand(
          terminal.ssh_host,
          `git diff -U${context} HEAD -- '${escapedPath}' 2>/dev/null || git diff -U${context} -- '${escapedPath}'`,
          { cwd: terminal.cwd },
        )
        if (!result.stdout.trim()) {
          // Try untracked file
          result = await execSSHCommand(
            terminal.ssh_host,
            `git diff --no-index -- /dev/null '${escapedPath}' || true`,
            { cwd: terminal.cwd },
          )
        }
        return { diff: result.stdout }
      }

      // Local: try tracked file diff first
      let diff = await new Promise<string>((resolve) => {
        execFile(
          'git',
          ['diff', `-U${context}`, 'HEAD', '--', filePath],
          { cwd, timeout: 10000 },
          (err, stdout) => {
            if (err) {
              // Fallback without HEAD (fresh repo)
              execFile(
                'git',
                ['diff', `-U${context}`, '--', filePath],
                { cwd, timeout: 10000 },
                (_err2, stdout2) => resolve(stdout2 || ''),
              )
            } else {
              resolve(stdout)
            }
          },
        )
      })

      if (!diff.trim()) {
        // Try untracked file
        diff = await new Promise<string>((resolve) => {
          execFile(
            'git',
            ['diff', '--no-index', '--', '/dev/null', filePath],
            { cwd, timeout: 10000 },
            (_err, stdout) => {
              // exit code 1 is normal for --no-index with differences
              resolve(stdout || '')
            },
          )
        })
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
    const id = parseInt(request.params.id, 10)
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid terminal id' })
    }

    const terminal = await getTerminalById(id)
    if (!terminal) {
      return reply.status(404).send({ error: 'Terminal not found' })
    }

    if (!terminal.git_repo) {
      return reply.status(400).send({ error: 'Terminal has no git repo' })
    }

    const { message, amend, noVerify, files } = request.body
    const cwdPath = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

    try {
      // Stage files
      if (files && files.length > 0) {
        // Selective staging: reset then add specific files
        const resetCmd = 'git reset HEAD'
        if (terminal.ssh_host) {
          await execSSHCommand(terminal.ssh_host, resetCmd, {
            cwd: terminal.cwd,
          }).catch(() => {}) // swallow error on fresh repos
        } else {
          await new Promise<void>((resolve) => {
            execFile(
              'git',
              ['reset', 'HEAD'],
              { cwd: cwdPath, timeout: 30000 },
              () => resolve(), // swallow error on fresh repos
            )
          })
        }

        const addCmd = `git add -- ${files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')}`
        if (terminal.ssh_host) {
          const addResult = await execSSHCommand(terminal.ssh_host, addCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: addCmd,
            stdout: addResult.stdout,
            stderr: addResult.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['add', '--', ...files],
              { cwd: cwdPath, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: addCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }
      } else {
        // Stage all changes (default)
        const addCmd = 'git add -A'
        if (terminal.ssh_host) {
          const addResult = await execSSHCommand(terminal.ssh_host, addCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: addCmd,
            stdout: addResult.stdout,
            stderr: addResult.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['add', '-A'],
              { cwd: cwdPath, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: addCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }
      }

      if (amend) {
        // Amend with no-edit
        const amendArgs = ['commit', '--amend', '--no-edit']
        if (noVerify) amendArgs.push('--no-verify')
        const amendCmd = `git ${amendArgs.join(' ')}`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, amendCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: amendCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              amendArgs,
              { cwd: cwdPath, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: amendCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }
      } else {
        if (!message?.trim()) {
          return reply.status(400).send({ error: 'Commit message is required' })
        }

        // Commit
        const safeMessage = message.replace(/'/g, "'\\''")
        const commitArgs = ['commit', '-m', message]
        if (noVerify) commitArgs.push('--no-verify')
        const commitCmd = `git commit${noVerify ? ' --no-verify' : ''} -m '${safeMessage}'`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, commitCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: commitCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              commitArgs,
              { cwd: cwdPath, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: commitCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }
      }

      // Refresh git state
      detectGitBranch(id).catch(() => {})
      checkAndEmitSingleGitDirty(id).catch(() => {})

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

  // Rebase a branch onto the current branch
  fastify.post<{ Params: TerminalParams; Body: RebaseBranchBody }>(
    '/api/terminals/:id/rebase',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const { branch } = request.body
      if (!branch) {
        return reply.status(400).send({ error: 'Branch is required' })
      }

      const currentBranch = terminal.git_branch
      if (!currentBranch) {
        return reply
          .status(400)
          .send({ error: 'Could not determine current branch' })
      }

      if (branch === currentBranch) {
        return reply
          .status(400)
          .send({ error: 'Cannot rebase branch onto itself' })
      }

      try {
        // Rebase current branch onto the selected branch
        // git rebase <selected> rebases current onto selected
        const rebaseCmd = `git rebase ${branch.replace(/'/g, "'\\''")}`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, rebaseCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: rebaseCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['rebase', branch],
              { cwd: expandPath(terminal.cwd), timeout: 60000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: rebaseCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                  failed: !!err,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }

        // Refresh git branch detection
        detectGitBranch(id).catch(() => {})

        return { success: true, branch: currentBranch, onto: branch }
      } catch (err) {
        // Abort the rebase to leave repo in clean state
        const abortCmd = 'git rebase --abort'
        try {
          if (terminal.ssh_host) {
            await execSSHCommand(terminal.ssh_host, abortCmd, {
              cwd: terminal.cwd,
            })
          } else {
            await new Promise<void>((resolve) => {
              execFile(
                'git',
                ['rebase', '--abort'],
                { cwd: expandPath(terminal.cwd), timeout: 10000 },
                () => resolve(), // Ignore errors from abort
              )
            })
          }
        } catch {
          // Ignore abort errors
        }

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to rebase branch'
        return reply.status(400).send({
          success: false,
          branch,
          error: errorMessage,
        })
      }
    },
  )

  // Delete a local branch
  fastify.delete<{ Params: TerminalParams; Body: DeleteBranchBody }>(
    '/api/terminals/:id/branch',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const { branch, deleteRemote } = request.body
      if (!branch) {
        return reply.status(400).send({ error: 'Branch is required' })
      }

      const currentBranch = terminal.git_branch
      if (branch === currentBranch) {
        return reply.status(400).send({ error: 'Cannot delete current branch' })
      }

      try {
        // Delete the local branch with -D (force delete)
        const deleteCmd = `git branch -D ${branch.replace(/'/g, "'\\''")}`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, deleteCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: deleteCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['branch', '-D', branch],
              { cwd: expandPath(terminal.cwd), timeout: 10000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: deleteCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                  failed: !!err,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }

        // Delete remote branch if requested
        if (deleteRemote) {
          const deleteRemoteCmd = `git push origin --delete ${branch.replace(/'/g, "'\\''")}`
          if (terminal.ssh_host) {
            const result = await execSSHCommand(
              terminal.ssh_host,
              deleteRemoteCmd,
              { cwd: terminal.cwd },
            )
            logCommand({
              terminalId: id,
              category: 'git',
              command: deleteRemoteCmd,
              stdout: result.stdout,
              stderr: result.stderr,
            })
          } else {
            await new Promise<void>((resolve, reject) => {
              execFile(
                'git',
                ['push', 'origin', '--delete', branch],
                { cwd: expandPath(terminal.cwd), timeout: 30000 },
                (err, stdout, stderr) => {
                  logCommand({
                    terminalId: id,
                    category: 'git',
                    command: deleteRemoteCmd,
                    stdout,
                    stderr: err ? err.message : stderr,
                  })
                  if (err) reject(err)
                  else resolve()
                },
              )
            })
          }
        }

        return { success: true, branch, deletedRemote: !!deleteRemote }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete branch'
        return reply.status(400).send({
          success: false,
          branch,
          error: errorMessage,
        })
      }
    },
  )

  // Create a new branch from a given base branch and check it out
  fastify.post<{ Params: TerminalParams; Body: CreateBranchBody }>(
    '/api/terminals/:id/create-branch',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      if (!terminal.git_repo) {
        return reply.status(400).send({ error: 'Terminal has no git repo' })
      }

      const { name, from } = request.body
      if (!name) {
        return reply.status(400).send({ error: 'Branch name is required' })
      }
      if (!from) {
        return reply.status(400).send({ error: 'Source branch is required' })
      }

      const gitCmd = `git checkout -b ${name.replace(/'/g, "'\\''")} ${from.replace(/'/g, "'\\''")}`

      try {
        const cwd = expandPath(terminal.cwd)

        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, gitCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: gitCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['checkout', '-b', name, from],
              { cwd, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: gitCmd,
                  stdout,
                  stderr: err ? err.message : stderr,
                  failed: !!err,
                })
                if (err) reject(err)
                else resolve()
              },
            )
          })
        }

        // Refresh git branch detection
        detectGitBranch(id).catch(() => {})

        return { success: true, branch: name }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to create branch'
        return reply.status(400).send({
          success: false,
          branch: name,
          error: errorMessage,
        })
      }
    },
  )
}
