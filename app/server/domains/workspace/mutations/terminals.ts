import fs from 'node:fs'
import net from 'node:net'
import { scanAndEmitProcessesForTerminal } from '@domains/pty/monitor'
import {
  destroySessionsForTerminal,
  renameZellijSession,
  writeTerminalNameFile,
} from '@domains/pty/session'
import { disconnectShellClients } from '@domains/pty/websocket'
import {
  createTerminal as dbCreateTerminal,
  deleteTerminal as dbDeleteTerminal,
  updateTerminal as dbUpdateTerminal,
  getTerminalById,
  terminalCwdExists,
  terminalNameExists,
} from '@domains/workspace/db/terminals'
import {
  createTerminalInput,
  deleteTerminalInput,
  updateTerminalInput,
} from '@domains/workspace/schema/terminals'
import { autoDetectTerminal } from '@domains/workspace/services/auto-detect'
import { emitWorkspace } from '@domains/workspace/services/emit'
import {
  deleteTerminalWorkspace,
  rmrf,
  setupTerminalWorkspace,
} from '@domains/workspace/services/setup'
import serverEvents from '@server/lib/events'
import { expandPath, sanitizeName, shellEscape } from '@server/lib/strings'
import { log } from '@server/logger'
import { validateSSHHost } from '@server/ssh/config'
import { poolExecSSHCommand } from '@server/ssh/pool'
import { publicProcedure } from '@server/trpc'

function isLocalPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    sock.once('connect', () => {
      sock.destroy()
      resolve(false) // something is listening — taken
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(true) // connection refused — free
    })
  })
}

export const createTerminal = publicProcedure
  .input(createTerminalInput)
  .mutation(async ({ input }) => {
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
    } = input

    // --- Worktree mode (Add Workspace from existing terminal) ---
    if (source_terminal_id) {
      const sourceTerminal = await getTerminalById(source_terminal_id)
      if (!sourceTerminal?.git_repo) {
        throw new Error('Source terminal has no git repo')
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

      const terminal = await dbCreateTerminal(
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

      await autoDetectTerminal(terminal.id, { refreshPRChecks: true })
      return (await getTerminalById(terminal.id)) ?? terminal
    }

    if (git_repo) {
      // --- Git repo workspace creation (local or SSH) ---
      const repo = git_repo.trim()
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        throw new Error('git_repo must be in owner/repo format')
      }

      // Validate SSH host if provided alongside git repo
      let trimmedHost: string | null = null
      if (ssh_host) {
        trimmedHost = ssh_host.trim()
        if (trimmedHost) {
          const result = validateSSHHost(trimmedHost)
          if (!result.valid) {
            throw new Error(result.error)
          }
        }
      }

      // Build setup object
      const hasSetup = setup_script || delete_script
      const setupObj = hasSetup
        ? {
            ...(setup_script?.trim() ? { setup: setup_script.trim() } : {}),
            ...(delete_script?.trim() ? { delete: delete_script.trim() } : {}),
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
      const terminal = await dbCreateTerminal(
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
      await autoDetectTerminal(terminal.id, { refreshPRChecks: true })
      return (await getTerminalById(terminal.id)) ?? terminal
    }

    if (ssh_host) {
      // --- SSH terminal creation (without git repo) ---
      const trimmedHost = ssh_host.trim()
      if (!trimmedHost) {
        throw new Error('ssh_host cannot be empty')
      }

      const result = validateSSHHost(trimmedHost)
      if (!result.valid) {
        throw new Error(result.error)
      }

      const terminal = await dbCreateTerminal(
        rawCwd?.trim() || '~',
        name?.trim() || trimmedHost,
        null,
        trimmedHost,
      )
      await autoDetectTerminal(terminal.id, { refreshPRChecks: true })
      return (await getTerminalById(terminal.id)) ?? terminal
    }

    // --- Local terminal creation ---
    if (!rawCwd) {
      throw new Error('cwd is required')
    }

    // Expand ~ to home directory
    const cwd = expandPath(rawCwd.trim())

    try {
      const stat = await fs.promises.stat(cwd)
      if (!stat.isDirectory()) {
        throw new Error('Path is not a directory')
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Path is not a directory') {
        throw err
      }
      throw new Error('Directory does not exist')
    }

    // Check read and execute permissions (needed to cd into and list directory)
    try {
      await fs.promises.access(cwd, fs.constants.R_OK | fs.constants.X_OK)
    } catch {
      throw new Error('Permission denied: cannot access directory')
    }

    if (await terminalCwdExists(cwd)) {
      throw new Error('A project with this directory already exists')
    }

    const terminal = await dbCreateTerminal(cwd, name || null, shell || null)
    await autoDetectTerminal(terminal.id, { refreshPRChecks: true })
    return (await getTerminalById(terminal.id)) ?? terminal
  })

export const updateTerminal = publicProcedure
  .input(updateTerminalInput)
  .mutation(async ({ input }) => {
    const { id, restartShells, ...updates } = input
    const terminal = await getTerminalById(id)
    if (!terminal) throw new Error('Terminal not found')

    // Check for duplicate name on rename
    if (
      updates.name !== undefined &&
      (await terminalNameExists(updates.name, id))
    ) {
      throw new Error('A terminal with this name already exists')
    }

    // Validate new port mappings — check local ports are available
    const newMappings = updates.settings?.portMappings
    const oldMappings = terminal.settings?.portMappings ?? []
    if (newMappings) {
      for (const mapping of newMappings) {
        // Skip ports that are already mapped (no change)
        if (
          oldMappings.some(
            (m) => m.port === mapping.port && m.localPort === mapping.localPort,
          )
        )
          continue
        const available = await isLocalPortAvailable(mapping.localPort)
        if (!available) {
          throw new Error(`Local port ${mapping.localPort} is already in use`)
        }
      }
    }

    await dbUpdateTerminal(id, updates)

    // Restart PTY sessions so they pick up the new shell
    if (restartShells && terminal.shells.length > 0) {
      const shellIds = terminal.shells.map((s) => s.id)
      destroySessionsForTerminal(id)
      // Disconnect WS clients after a short delay so exit message reaches them first
      setTimeout(() => disconnectShellClients(shellIds), 500)
    }

    // Handle name change: update name files and rename zellij session
    if (updates.name !== undefined) {
      const oldName = terminal.name
      const newName = updates.name
      writeTerminalNameFile(id, newName)

      // Also write name file on remote host for SSH terminals (fire-and-forget)
      if (terminal.ssh_host) {
        const sanitized = sanitizeName(newName)
        poolExecSSHCommand(
          terminal.ssh_host!,
          `mkdir -p ~/.workio/terminals && printf '%s' ${shellEscape(sanitized)} > ~/.workio/terminals/${id}`,
          { timeout: 5000 },
        ).catch(() => {})
      }

      // Rename zellij session if it exists
      if (oldName && oldName !== newName) {
        renameZellijSession(
          sanitizeName(oldName),
          sanitizeName(newName),
          terminal.ssh_host,
        )
      }
    }

    // Trigger immediate process scan when port mappings change
    if (updates.settings !== undefined) {
      scanAndEmitProcessesForTerminal(id).catch((err) =>
        log.error(
          { err },
          `[terminals] Failed to scan after settings update for terminal ${id}`,
        ),
      )
    }

    return getTerminalById(id)
  })

export const deleteTerminal = publicProcedure
  .input(deleteTerminalInput)
  .mutation(async ({ input }) => {
    const { id, deleteDirectory } = input
    const terminal = await getTerminalById(id)
    if (!terminal) throw new Error('Terminal not found')

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
      await dbUpdateTerminal(id, { setup: deleteSetup })
      emitWorkspace(id, { setup: deleteSetup })
      deleteTerminalWorkspace(id).catch((err) =>
        log.error(
          `[terminals] Delete workspace error: ${err instanceof Error ? err.message : err}`,
        ),
      )
      serverEvents.emit('github:refresh-pr-checks')
      // Return true to indicate async delete flow (status 202 equivalent)
      return { async: true }
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

    await dbDeleteTerminal(id)
    serverEvents.emit('github:refresh-pr-checks')
    return { async: false }
  })
