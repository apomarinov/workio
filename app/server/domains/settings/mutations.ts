import { refreshPRChecks } from '../../github/checks'
import { execFileAsync } from '../../lib/exec'
import { publicProcedure } from '../../trpc/init'
import { updateSettings } from './db'
import { updateSettingsInput } from './schema'

export const update = publicProcedure
  .input(updateSettingsInput)
  .mutation(async ({ input }) => {
    // Verify shell exists if provided (filesystem check, can't be in Zod)
    if (input.default_shell) {
      const shellExists = await execFileAsync('sh', [
        '-c',
        `command -v ${input.default_shell}`,
      ]).then(
        () => true,
        () => false,
      )
      if (!shellExists) {
        throw new Error(`Shell not found: ${input.default_shell}`)
      }
    }

    const settings = await updateSettings(input)

    // Refresh PR checks when hidden_prs changes
    if (input.hidden_prs !== undefined) {
      refreshPRChecks(true)
    }

    return settings
  })
