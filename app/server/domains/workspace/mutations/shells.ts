import {
  destroySession,
  interruptSession,
  killShellChildren,
  renameZellijSession,
  setPendingCommand,
  updateSessionName,
  waitForSession,
  writeShellNameFile,
  writeToSession,
} from '@domains/pty/session'
import { setActiveSessionDone } from '@domains/sessions/db'
import {
  createShell as dbCreateShell,
  deleteShell as dbDeleteShell,
  getShellById,
  updateShellName,
} from '@domains/workspace/db/shells'
import { getTerminalById } from '@domains/workspace/db/terminals'
import {
  createShellInput,
  renameShellInput,
  shellIdInput,
  writeShellInput,
} from '@domains/workspace/schema/shells'
import { getIO } from '@server/io'
import { sanitizeName, shellEscape } from '@server/lib/strings'
import { log } from '@server/logger'
import { execSSHCommandLogged } from '@server/ssh/exec'
import { publicProcedure } from '@server/trpc'

async function resolveShell(id: number) {
  const shell = await getShellById(id)
  if (!shell) throw new Error('Shell not found')
  return shell
}

export const createShell = publicProcedure
  .input(createShellInput)
  .mutation(async ({ input }) => {
    const { terminalId, name } = input

    const terminal = await getTerminalById(terminalId)
    if (!terminal) throw new Error('Terminal not found')

    const trimmedName = name?.trim()
    if (trimmedName === 'main') {
      throw new Error('"main" is a reserved shell name')
    }

    const shellName = trimmedName || `shell-${terminal.shells.length + 1}`
    return dbCreateShell(terminalId, shellName)
  })

export const deleteShell = publicProcedure
  .input(shellIdInput)
  .mutation(async ({ input }) => {
    const shell = await resolveShell(input.id)

    if (shell.name === 'main') {
      throw new Error('Cannot delete the main shell')
    }

    destroySession(shell.id)
    await dbDeleteShell(shell.id)
  })

export const renameShell = publicProcedure
  .input(renameShellInput)
  .mutation(async ({ input }) => {
    const shell = await resolveShell(input.id)

    if (shell.name === 'main') {
      throw new Error('Cannot rename the main shell')
    }

    const trimmedName = input.name.trim()
    if (!trimmedName) throw new Error('Name is required')
    if (trimmedName === 'main') {
      throw new Error('Cannot use reserved name "main"')
    }

    const terminal = await getTerminalById(shell.terminal_id)
    if (!terminal) throw new Error('Terminal not found')

    const terminalName = terminal.name || `terminal-${terminal.id}`
    const oldSessionName = `${terminalName}-${shell.name}`
    const newSessionName = `${terminalName}-${trimmedName}`

    const updated = await updateShellName(shell.id, trimmedName)
    const sanitizedName = sanitizeName(newSessionName)
    renameZellijSession(
      sanitizeName(oldSessionName),
      sanitizedName,
      terminal.ssh_host,
    )
    updateSessionName(shell.id, newSessionName)
    writeShellNameFile(shell.id, newSessionName)

    // Also write on remote host for SSH terminals (fire-and-forget)
    if (terminal.ssh_host) {
      execSSHCommandLogged(
        terminal.ssh_host,
        `mkdir -p ~/.workio/shells && printf '%s' ${shellEscape(sanitizedName)} > ~/.workio/shells/${shell.id}`,
        { category: 'workspace', errorOnly: true, timeout: 5000 },
      ).catch(() => {})
    }

    return updated
  })

export const writeShell = publicProcedure
  .input(writeShellInput)
  .mutation(async ({ input }) => {
    await resolveShell(input.id)

    if (input.pending) {
      // Queue command to run after shell integration is ready (first prompt)
      setPendingCommand(input.id, input.data.replace(/\n$/, ''))
      return
    }

    // Wait for PTY session to be ready (up to 10s)
    const ready = await waitForSession(input.id, 10000)
    if (!ready) throw new Error('Shell session not ready')

    const written = writeToSession(input.id, input.data)
    if (!written) throw new Error('Failed to write to shell')
  })

export const interruptShell = publicProcedure
  .input(shellIdInput)
  .mutation(async ({ input }) => {
    await resolveShell(input.id)

    // If the shell's session is waiting for permission, mark it done
    const doneSessionId = await setActiveSessionDone(input.id)
    if (doneSessionId) {
      log.info(
        `[interrupt] Set permission_needed session=${doneSessionId} to done (shell=${input.id})`,
      )
      const io = getIO()
      io?.emit('session:updated', {
        sessionId: doneSessionId,
        data: { status: 'done' },
      })
    }

    interruptSession(input.id)
  })

export const killShell = publicProcedure
  .input(shellIdInput)
  .mutation(async ({ input }) => {
    await resolveShell(input.id)
    killShellChildren(input.id)
  })
