import { env } from '@server/env'
import serverEvents from '@server/lib/events'
import { execFileAsyncLogged } from '@server/lib/exec'
import { publicProcedure } from '@server/trpc'
import { getSettings, updateSettings } from './db'
import { updateSettingsInput } from './schema'

export const update = publicProcedure
  .input(updateSettingsInput)
  .mutation(async ({ input }) => {
    // Verify shell exists if provided (filesystem check, can't be in Zod)
    if (input.default_shell) {
      const shellExists = await execFileAsyncLogged(
        'sh',
        ['-c', `command -v ${input.default_shell}`],
        { category: 'workspace', errorOnly: true },
      ).then(
        () => true,
        () => false,
      )
      if (!shellExists) {
        throw new Error(`Shell not found: ${input.default_shell}`)
      }
    }

    // Merge ngrok config so partial updates (e.g. domain only) don't lose the token
    if (input.ngrok !== undefined) {
      const current = await getSettings()
      input.ngrok = { ...current.ngrok, ...input.ngrok }

      if ((input.ngrok.domain || input.ngrok.token) && !env.BASIC_AUTH) {
        throw new Error(
          'BASIC_AUTH environment variable must be set before enabling ngrok — exposing the app without auth is unsafe',
        )
      }
    }

    const settings = await updateSettings(input)

    if (input.hidden_prs !== undefined) {
      serverEvents.emit('github:refresh-pr-checks')
    }

    if (input.ngrok !== undefined) {
      serverEvents.emit('ngrok:config-changed')
    }

    return settings
  })
