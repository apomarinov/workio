import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'

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

import {
  createTerminal,
  deleteTerminal,
  getAllTerminals,
  getTerminalById,
  updateTerminal,
} from '../db'
import { refreshPRChecks } from '../github/checks'
import { log } from '../logger'
import { destroySession } from '../pty/manager'
import { listSSHHosts, validateSSHHost } from '../ssh/config'
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
  conductor?: boolean
  workspaces_root?: string
  setup_script?: string
  delete_script?: string
  source_terminal_id?: number
}

interface UpdateTerminalBody {
  name?: string
  cwd?: string
}

interface TerminalParams {
  id: string
}

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

  // List available SSH hosts from ~/.ssh/config
  fastify.get('/api/ssh/hosts', async () => {
    return listSSHHosts()
  })

  // List all terminals
  fastify.get('/api/terminals', async () => {
    const terminals = await getAllTerminals()
    return terminals.map((terminal) => ({
      ...terminal,
      orphaned: terminal.ssh_host ? false : !fs.existsSync(terminal.cwd),
    }))
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
        conductor,
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
        const hasSetup = conductor || setup_script || delete_script
        const setupObj = hasSetup
          ? {
              ...(conductor ? { conductor: true } : {}),
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
        return reply.status(201).send(terminal)
      }

      // --- Local terminal creation ---
      if (!rawCwd) {
        return reply.status(400).send({ error: 'cwd is required' })
      }

      // Expand ~ to home directory
      const cwd = expandPath(rawCwd.trim())

      if (!fs.existsSync(cwd)) {
        return reply.status(400).send({ error: 'Directory does not exist' })
      }

      const stat = fs.statSync(cwd)
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: 'Path is not a directory' })
      }

      // Check read and execute permissions (needed to cd into and list directory)
      try {
        fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK)
      } catch {
        return reply
          .status(403)
          .send({ error: 'Permission denied: cannot access directory' })
      }

      const terminal = await createTerminal(cwd, name || null, shell || null)
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

      const body = { ...request.body }

      // Validate cwd if provided (skip for SSH terminals — path is remote)
      if (body.cwd !== undefined) {
        if (terminal.ssh_host) {
          body.cwd = body.cwd.trim()
        } else {
          const cwd = expandPath(body.cwd.trim())
          if (!fs.existsSync(cwd)) {
            return reply.status(400).send({ error: 'Directory does not exist' })
          }
          const stat = fs.statSync(cwd)
          if (!stat.isDirectory()) {
            return reply.status(400).send({ error: 'Path is not a directory' })
          }
          try {
            fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK)
          } catch {
            return reply
              .status(403)
              .send({ error: 'Permission denied: cannot access directory' })
          }
          body.cwd = cwd
        }
      }

      const updated = await updateTerminal(id, body)
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

    // Kill PTY session if running
    const killed = destroySession(id)
    if (killed) {
      log.info(`[terminals] Killed PTY session for terminal ${id}`)
    }

    // Setup with delete script or conductor: run delete script async, then delete
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
      refreshPRChecks()
      return reply.status(202).send()
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
    refreshPRChecks()
    return reply.status(204).send()
  })
}
