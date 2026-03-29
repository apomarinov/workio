import fs from 'node:fs'
import { getTerminals } from '@domains/workspace/db/terminals'
import { publicProcedure } from '@server/trpc'
import { z } from 'zod'

function enrichTerminal(
  terminal: Awaited<ReturnType<typeof getTerminals>>[number],
) {
  const isSettingUp =
    terminal.git_repo?.status === 'setup' || terminal.setup?.status === 'setup'
  return {
    ...terminal,
    orphaned:
      terminal.ssh_host || isSettingUp ? false : !fs.existsSync(terminal.cwd),
  }
}

export const listTerminals = publicProcedure.query(async () => {
  const terminals = await getTerminals()
  return terminals.map(enrichTerminal)
})

export const getTerminal = publicProcedure
  .input(z.object({ id: z.number() }))
  .query(async ({ input }) => {
    const terminals = await getTerminals(input.id)
    return terminals[0] ? enrichTerminal(terminals[0]) : null
  })
