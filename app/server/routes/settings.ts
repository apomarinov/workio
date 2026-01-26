import { execSync } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import { getSettings, updateSettings } from '../db'

interface UpdateSettingsBody {
  default_shell: string
}

export default async function settingsRoutes(fastify: FastifyInstance) {
  // Get settings
  fastify.get('/api/settings', async () => {
    return getSettings()
  })

  // Update settings
  fastify.patch<{ Body: UpdateSettingsBody }>(
    '/api/settings',
    async (request, reply) => {
      const { default_shell } = request.body

      if (!default_shell) {
        return reply.status(400).send({ error: 'default_shell is required' })
      }

      // Verify shell exists
      try {
        execSync(`command -v ${default_shell}`, { stdio: 'pipe' })
      } catch {
        return reply
          .status(400)
          .send({ error: `Shell not found: ${default_shell}` })
      }

      const settings = updateSettings(default_shell)
      return settings
    },
  )
}
