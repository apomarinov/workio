import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '@server/env'
import serverEvents from '@server/lib/events'
import { execFileAsync, execFileAsyncLogged } from '@server/lib/exec'
import { getLocalIp } from '@server/lib/network'
import { publicProcedure } from '@server/trpc'
import { getSettings, updateSettings } from './db'
import { updateSettingsInput } from './schema'
import { applyServerConfig } from './server-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

    if (input.server_config !== undefined) {
      applyServerConfig(input.server_config)
    }

    if (input.hidden_prs !== undefined) {
      serverEvents.emit('github:refresh-pr-checks')
    }

    if (input.ngrok !== undefined) {
      serverEvents.emit('ngrok:config-changed')
    }

    return settings
  })

export const generateCerts = publicProcedure.mutation(async () => {
  // Check mkcert is installed
  try {
    await execFileAsync('which', ['mkcert'], { timeout: 5000 })
  } catch {
    throw new Error(
      'mkcert is not installed. Install it with: brew install mkcert',
    )
  }

  const localIp = await getLocalIp()
  const certsDir = path.join(__dirname, '../../../../certs')

  fs.mkdirSync(certsDir, { recursive: true })

  const certPath = path.join(certsDir, 'cert.pem')
  const keyPath = path.join(certsDir, 'key.pem')

  // Install root CA if needed
  await execFileAsync('mkcert', ['-install'], { timeout: 30000 })

  // Generate certificate
  await execFileAsync(
    'mkcert',
    [
      '-cert-file',
      certPath,
      '-key-file',
      keyPath,
      'localhost',
      '127.0.0.1',
      localIp,
    ],
    { timeout: 30000 },
  )

  // Get CA root path for iPhone instructions
  const { stdout: caRoot } = await execFileAsync('mkcert', ['-CAROOT'], {
    timeout: 5000,
  })

  return {
    certPath,
    keyPath,
    localIp,
    caRootPath: path.join(caRoot.trim(), 'rootCA.pem'),
  }
})
