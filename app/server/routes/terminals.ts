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
  createShell,
  createTerminal,
  deleteShell,
  deleteTerminal,
  getAllTerminals,
  getShellById,
  getTerminalById,
  logCommand,
  setPermissionNeededSessionDone,
  terminalNameExists,
  updateShellName,
  updateTerminal,
} from '../db'
import { refreshPRChecks, trackTerminal } from '../github/checks'
import { getIO } from '../io'
import { log } from '../logger'
import {
  checkAndEmitSingleGitDirty,
  destroySession,
  destroySessionsForTerminal,
  detectGitBranch,
  interruptSession,
  killShellChildren,
  renameZellijSession,
  updateSessionName,
  waitForSession,
  writeShellNameFile,
  writeToSession,
} from '../pty/manager'
import { listSSHHosts, validateSSHHost } from '../ssh/config'
import { execSSHCommand } from '../ssh/exec'
import {
  cancelWorkspaceOperation,
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
    let terminalCwd: string | null = null
    if (terminal_id != null) {
      const terminal = await getTerminalById(terminal_id)
      if (terminal) {
        terminalCwd = terminal.cwd
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

    // Include terminal cwd so the IDE opens the correct workspace window
    const args = terminalCwd
      ? [terminalCwd, '--goto', targetPath]
      : ['--goto', targetPath]

    return new Promise<void>((resolve) => {
      execFile(cmd, args, { timeout: 5000 }, (err) => {
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
  fastify.post<{ Body: { path: string; terminal_id?: number } }>(
    '/api/open-in-explorer',
    async (request, reply) => {
      const { path: rawPath, terminal_id } = request.body
      if (!rawPath) {
        return reply.status(400).send({ error: 'Path is required' })
      }

      // Strip :line:col suffix (not relevant for file explorer)
      const pathOnly = rawPath.replace(/:\d+(?::\d+)?$/, '')

      // Resolve relative paths against terminal cwd
      let resolvedPath = pathOnly
      if (terminal_id != null) {
        const terminal = await getTerminalById(terminal_id)
        if (
          terminal &&
          !pathOnly.startsWith('/') &&
          !pathOnly.startsWith('~')
        ) {
          resolvedPath = `${terminal.cwd}/${pathOnly}`
        }
      }

      const targetPath = expandPath(resolvedPath)
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
      // Use -R on macOS to reveal files in Finder instead of opening them
      const args =
        process.platform === 'darwin' ? ['-R', targetPath] : [targetPath]

      return new Promise<void>((resolve) => {
        execFile(cmd, args, (err) => {
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

  // Create a directory
  fastify.post<{ Body: { path: string; name: string; ssh_host?: string } }>(
    '/api/create-directory',
    async (request, reply) => {
      const { path: parentPath, name, ssh_host } = request.body
      if (!parentPath || !name) {
        return reply.status(400).send({ error: 'path and name are required' })
      }
      if (name.includes('/') || name.includes('\\')) {
        return reply
          .status(400)
          .send({ error: 'Folder name cannot contain path separators' })
      }

      try {
        if (ssh_host) {
          const validation = validateSSHHost(ssh_host)
          if (!validation.valid) {
            return reply.status(400).send({ error: validation.error })
          }
          const fullPath = `${parentPath}/${name}`
          await execSSHCommand(
            ssh_host,
            `mkdir ${fullPath.replace(/'/g, "'\\''")}`,
          )
          return { path: fullPath }
        }

        const dirPath = expandPath(parentPath)
        const fullPath = path.join(dirPath, name)
        await fs.promises.mkdir(fullPath)
        const resultPath =
          parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
        return { path: resultPath }
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Failed to create folder',
        })
      }
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

    // Kill all PTY sessions for non-delete-flow paths
    const killed = destroySessionsForTerminal(id)
    if (killed) {
      log.info(`[terminals] Killed PTY sessions for terminal ${id}`)
    }

    // Delete workspace directory if requested
    if (deleteDirectory) {
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

  // Cancel a running workspace operation (clone, setup, or teardown)
  fastify.post<{ Params: TerminalParams }>(
    '/api/terminals/:id/cancel-workspace',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const cancelled = cancelWorkspaceOperation(id)
      if (!cancelled) {
        return reply.status(409).send({ error: 'No cancellable operation' })
      }

      return { cancelled: true }
    },
  )

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

  // Fetch all remotes
  fastify.post<{ Params: TerminalParams }>(
    '/api/terminals/:id/fetch-all',
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
        if (terminal.ssh_host) {
          const result = await execSSHCommand(
            terminal.ssh_host,
            'git fetch --all',
            { cwd: terminal.cwd },
          )
          logCommand({
            terminalId: id,
            category: 'git',
            command: 'git fetch --all',
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['fetch', '--all'],
              { cwd: expandPath(terminal.cwd), timeout: 30000 },
              (err, stdout, stderr) => {
                if (err) return reject(err)
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: 'git fetch --all',
                  stdout,
                  stderr,
                })
                resolve()
              },
            )
          })
        }

        return { success: true }
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Failed to fetch',
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
          }).catch((err) =>
            log.error(
              { err, terminalId: id },
              '[git] Failed to prune worktrees',
            ),
          )

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
        detectGitBranch(id)

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
        detectGitBranch(id)

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
        detectGitBranch(id)

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
          const [
            numstatResult,
            nameStatusResult,
            untrackedResult,
            untrackedWcResult,
          ] = await Promise.all([
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
            execSSHCommand(
              terminal.ssh_host,
              'git ls-files -z --others --exclude-standard | xargs -0 wc -l 2>/dev/null',
              { cwd: terminal.cwd },
            ),
          ])

          const files = parseChangedFiles(
            numstatResult.stdout,
            nameStatusResult.stdout,
            untrackedResult.stdout,
            untrackedWcResult.stdout,
          )
          return { files }
        }

        // Local: run 4 git commands in parallel
        const [numstatOut, nameStatusOut, untrackedOut, untrackedWcOut] =
          await Promise.all([
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
            new Promise<string>((resolve) => {
              execFile(
                'sh',
                [
                  '-c',
                  'git ls-files -z --others --exclude-standard | xargs -0 wc -l 2>/dev/null',
                ],
                { cwd, timeout: 10000 },
                (_err, stdout) => resolve(stdout || ''),
              )
            }),
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
          }).catch((err) =>
            log.error(
              { err, terminalId: id },
              '[git] Failed to reset HEAD (may be fresh repo)',
            ),
          )
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
      detectGitBranch(id).catch((err) =>
        log.error({ err, terminalId: id }, '[git] Failed to detect branch'),
      )
      checkAndEmitSingleGitDirty(id)

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

    const { files } = request.body
    if (!files || files.length === 0) {
      return reply.status(400).send({ error: 'No files specified' })
    }

    const cwdPath = terminal.ssh_host ? terminal.cwd : expandPath(terminal.cwd)

    try {
      // Get file statuses to determine which git commands to use
      let nameStatusOut: string
      let untrackedOut: string
      if (terminal.ssh_host) {
        const [nsResult, utResult] = await Promise.all([
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
        nameStatusOut = nsResult.stdout
        untrackedOut = utResult.stdout
      } else {
        ;[nameStatusOut, untrackedOut] = await Promise.all([
          new Promise<string>((resolve) => {
            execFile(
              'git',
              ['diff', '--name-status', 'HEAD'],
              { cwd: cwdPath, timeout: 10000 },
              (err, stdout) => {
                if (err) {
                  execFile(
                    'git',
                    ['diff', '--name-status'],
                    { cwd: cwdPath, timeout: 10000 },
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
              { cwd: cwdPath, timeout: 10000 },
              (_err, stdout) => resolve(stdout || ''),
            )
          }),
        ])
      }

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
        const checkoutCmd = `git checkout HEAD -- ${trackedToRevert.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')}`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, checkoutCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: checkoutCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['checkout', 'HEAD', '--', ...trackedToRevert],
              { cwd: cwdPath, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: checkoutCmd,
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
      }

      // Remove staged new files
      if (stagedNew.length > 0) {
        const rmCmd = `git rm -f -- ${stagedNew.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')}`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, rmCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: rmCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['rm', '-f', '--', ...stagedNew],
              { cwd: cwdPath, timeout: 30000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: rmCmd,
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
      }

      // Delete untracked files
      if (untracked.length > 0) {
        if (terminal.ssh_host) {
          const rmCmd = `rm -f -- ${untracked.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')}`
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
      checkAndEmitSingleGitDirty(id)

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
        detectGitBranch(id)

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

  // Rename a local branch
  interface RenameBranchBody {
    branch: string
    newName: string
  }

  fastify.post<{ Params: TerminalParams; Body: RenameBranchBody }>(
    '/api/terminals/:id/rename-branch',
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

      const { branch, newName } = request.body
      if (!branch) {
        return reply.status(400).send({ error: 'Branch is required' })
      }
      if (!newName) {
        return reply.status(400).send({ error: 'New name is required' })
      }

      try {
        // Pre-check: ensure target name doesn't already exist
        if (terminal.ssh_host) {
          const listResult = await execSSHCommand(
            terminal.ssh_host,
            `git branch --list '${newName.replace(/'/g, "'\\''")}'`,
            { cwd: terminal.cwd },
          )
          if (listResult.stdout.trim()) {
            return reply
              .status(400)
              .send({ error: `Branch '${newName}' already exists` })
          }
        } else {
          const exists = await new Promise<boolean>((resolve) => {
            execFile(
              'git',
              ['branch', '--list', newName],
              { cwd: expandPath(terminal.cwd), timeout: 5000 },
              (_err, stdout) => {
                resolve(!!stdout.trim())
              },
            )
          })
          if (exists) {
            return reply
              .status(400)
              .send({ error: `Branch '${newName}' already exists` })
          }
        }

        // Rename the branch
        const renameCmd = `git branch -m ${branch.replace(/'/g, "'\\''").replace(/ /g, '\\ ')} ${newName.replace(/'/g, "'\\''").replace(/ /g, '\\ ')}`
        if (terminal.ssh_host) {
          const result = await execSSHCommand(terminal.ssh_host, renameCmd, {
            cwd: terminal.cwd,
          })
          logCommand({
            terminalId: id,
            category: 'git',
            command: renameCmd,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            execFile(
              'git',
              ['branch', '-m', branch, newName],
              { cwd: expandPath(terminal.cwd), timeout: 10000 },
              (err, stdout, stderr) => {
                logCommand({
                  terminalId: id,
                  category: 'git',
                  command: renameCmd,
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

        detectGitBranch(id)
        return { success: true, branch, newName }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to rename branch'
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
        detectGitBranch(id)

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

  // Create a new shell for a terminal
  fastify.post<{ Params: TerminalParams; Body: { name?: string } }>(
    '/api/terminals/:id/shells',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      const name = request.body?.name?.trim()
      if (name === 'main') {
        return reply
          .status(400)
          .send({ error: '"main" is a reserved shell name' })
      }

      // Auto-generate name if not provided
      const shellName = name || `shell-${terminal.shells.length + 1}`

      const shell = await createShell(id, shellName)
      return reply.status(201).send(shell)
    },
  )

  // Delete a shell
  fastify.delete<{ Params: { id: string } }>(
    '/api/shells/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid shell id' })
      }

      const shell = await getShellById(id)
      if (!shell) {
        return reply.status(404).send({ error: 'Shell not found' })
      }

      if (shell.name === 'main') {
        return reply.status(400).send({ error: 'Cannot delete the main shell' })
      }

      // Destroy PTY session for this shell
      destroySession(id)

      await deleteShell(id)
      return reply.status(204).send()
    },
  )

  // Rename a shell
  fastify.patch<{ Params: { id: string }; Body: { name: string } }>(
    '/api/shells/:id',
    async (request, reply) => {
      const id = Number(request.params.id)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid shell id' })
      }

      const shell = await getShellById(id)
      if (!shell) {
        return reply.status(404).send({ error: 'Shell not found' })
      }

      if (shell.name === 'main') {
        return reply.status(400).send({ error: 'Cannot rename the main shell' })
      }

      const { name } = request.body
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Name is required' })
      }

      const trimmedName = name.trim()
      if (trimmedName === 'main') {
        return reply
          .status(400)
          .send({ error: 'Cannot use reserved name "main"' })
      }

      const terminal = await getTerminalById(shell.terminal_id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      const terminalName = terminal.name || `terminal-${terminal.id}`
      const oldSessionName = `${terminalName}-${shell.name}`
      const newSessionName = `${terminalName}-${trimmedName}`

      const updated = await updateShellName(id, trimmedName)
      renameZellijSession(oldSessionName, newSessionName)
      updateSessionName(id, newSessionName)
      writeShellNameFile(id, trimmedName)

      return reply.send(updated)
    },
  )

  // Write data to a shell's PTY session
  fastify.post<{ Params: { id: string }; Body: { data: string } }>(
    '/api/shells/:id/write',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid shell id' })
      }

      const shell = await getShellById(id)
      if (!shell) {
        return reply.status(404).send({ error: 'Shell not found' })
      }

      const { data } = request.body
      if (typeof data !== 'string') {
        return reply.status(400).send({ error: 'data is required' })
      }

      // Wait for PTY session to be ready (up to 10s)
      const ready = await waitForSession(id, 10000)
      if (!ready) {
        return reply.status(503).send({ error: 'Shell session not ready' })
      }

      const written = writeToSession(id, data)
      if (!written) {
        return reply.status(500).send({ error: 'Failed to write to shell' })
      }

      return { success: true }
    },
  )

  // Send interrupt (Ctrl+C) to a shell's PTY session
  fastify.post<{ Params: { id: string } }>(
    '/api/shells/:id/interrupt',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid shell id' })
      }

      const shell = await getShellById(id)
      if (!shell) {
        return reply.status(404).send({ error: 'Shell not found' })
      }

      // If the shell's session is waiting for permission, mark it done
      const doneSessionId = await setPermissionNeededSessionDone(id)
      if (doneSessionId) {
        log.info(
          `[interrupt] Set permission_needed session=${doneSessionId} to done (shell=${id})`,
        )
        const io = getIO()
        io?.emit('session:updated', {
          sessionId: doneSessionId,
          data: { status: 'done' },
        })
      }

      interruptSession(id)
      return { success: true }
    },
  )

  // Kill all child processes in a shell (SIGKILL to direct children)
  fastify.post<{ Params: { id: string } }>(
    '/api/shells/:id/kill',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid shell id' })
      }

      const shell = await getShellById(id)
      if (!shell) {
        return reply.status(404).send({ error: 'Shell not found' })
      }

      killShellChildren(id)
      return { success: true }
    },
  )
}
