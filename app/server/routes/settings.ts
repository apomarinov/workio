import { execSync } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import type { Settings } from '../../src/types'
import { getSettings, updateSettings } from '../db'

type UpdateSettingsBody = Partial<Omit<Settings, 'id'>>

export default async function settingsRoutes(fastify: FastifyInstance) {
  // Get settings
  fastify.get('/api/settings', async () => {
    return await getSettings()
  })

  // Update settings
  fastify.patch<{ Body: UpdateSettingsBody }>(
    '/api/settings',
    async (request, reply) => {
      const updates = request.body

      // Validate at least one field is provided
      if (Object.keys(updates).length === 0) {
        return reply
          .status(400)
          .send({ error: 'At least one setting must be provided' })
      }

      // Verify shell exists if provided
      if (updates.default_shell) {
        try {
          execSync(`command -v ${updates.default_shell}`, { stdio: 'pipe' })
        } catch {
          return reply
            .status(400)
            .send({ error: `Shell not found: ${updates.default_shell}` })
        }
      }

      // Validate font_size if provided
      if (updates.font_size !== undefined && updates.font_size !== null) {
        if (updates.font_size < 8 || updates.font_size > 32) {
          return reply
            .status(400)
            .send({ error: 'Font size must be between 8 and 32' })
        }
      }

      // Validate message_line_clamp if provided
      if (updates.message_line_clamp !== undefined) {
        if (updates.message_line_clamp < 1 || updates.message_line_clamp > 20) {
          return reply
            .status(400)
            .send({ error: 'Message line clamp must be between 1 and 20' })
        }
      }

      const settings = await updateSettings(updates)
      return settings
    },
  )
}
