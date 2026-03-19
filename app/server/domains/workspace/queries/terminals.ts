import fs from 'node:fs'
import { publicProcedure } from '@server/trpc/init'
import { z } from 'zod'
import { getAllTerminals, getTerminalById } from '../db/terminals'

export const listTerminals = publicProcedure.query(async () => {
  const terminals = await getAllTerminals()
  return terminals.map((terminal) => {
    // Don't mark as orphaned if it's being set up (directory doesn't exist yet)
    const isSettingUp =
      terminal.git_repo?.status === 'setup' ||
      terminal.setup?.status === 'setup'
    return {
      ...terminal,
      orphaned:
        terminal.ssh_host || isSettingUp ? false : !fs.existsSync(terminal.cwd),
    }
  })
})

export const getTerminalByIdQuery = publicProcedure
  .input(z.object({ id: z.number() }))
  .query(async ({ input }) => {
    const terminal = await getTerminalById(input.id)
    if (!terminal) throw new Error('Terminal not found')
    return terminal
  })
