import { log } from '@server/logger'
import { publicProcedure } from '@server/trpc/init'
import { z } from 'zod'
import { getTerminalById, updateTerminal } from '../db/terminals'
import { emitWorkspace } from '../services/emit'
import { cancelWorkspaceOperation, rerunSetupScript } from '../services/setup'

const terminalIdInput = z.object({
  id: z.number(),
})

export const cancelWorkspace = publicProcedure
  .input(terminalIdInput)
  .mutation(async ({ input }) => {
    const { id } = input

    const cancelled = cancelWorkspaceOperation(id)
    if (!cancelled) {
      // No in-memory operation — check if DB is stuck in setup state (e.g. server killed mid-setup)
      const terminal = await getTerminalById(id)
      if (terminal?.setup?.status === 'setup') {
        const failedSetup = {
          ...terminal.setup,
          status: 'failed' as const,
          error: 'Setup interrupted',
        }
        await updateTerminal(id, { setup: failedSetup })
        await emitWorkspace(id, { name: terminal.name, setup: failedSetup })
        return { cancelled: true }
      }
      throw new Error('No cancellable operation')
    }

    return { cancelled: true }
  })

export const rerunSetup = publicProcedure
  .input(terminalIdInput)
  .mutation(async ({ input }) => {
    const terminal = await getTerminalById(input.id)
    if (!terminal) throw new Error('Terminal not found')
    if (terminal.setup?.status !== 'failed') {
      throw new Error('Setup is not in failed state')
    }

    // Fire-and-forget
    rerunSetupScript(input.id).catch((err) =>
      log.error(
        `[setup] Rerun error: ${err instanceof Error ? err.message : err}`,
      ),
    )
    return { ok: true }
  })

export const clearSetupError = publicProcedure
  .input(terminalIdInput)
  .mutation(async ({ input }) => {
    const terminal = await getTerminalById(input.id)
    if (!terminal) throw new Error('Terminal not found')
    if (terminal.setup?.status !== 'failed') {
      throw new Error('Setup is not in failed state')
    }

    const doneSetup = {
      ...terminal.setup,
      status: 'done' as const,
      error: undefined,
    }
    await updateTerminal(input.id, { setup: doneSetup })
    await emitWorkspace(input.id, { name: terminal.name, setup: doneSetup })
    return { ok: true }
  })
