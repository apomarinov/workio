import { execSync } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import { getSettings, updateSettings } from '../db'

interface UpdateSettingsBody {
  default_shell?: string
  font_size?: number | null
  show_thinking?: boolean
  show_tool_output?: boolean
  message_line_clamp?: number
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
      const {
        default_shell,
        font_size,
        show_thinking,
        show_tool_output,
        message_line_clamp,
      } = request.body

      // Validate at least one field is provided
      if (
        default_shell === undefined &&
        font_size === undefined &&
        show_thinking === undefined &&
        show_tool_output === undefined &&
        message_line_clamp === undefined
      ) {
        return reply
          .status(400)
          .send({ error: 'At least one setting must be provided' })
      }

      // Verify shell exists if provided
      if (default_shell) {
        try {
          execSync(`command -v ${default_shell}`, { stdio: 'pipe' })
        } catch {
          return reply
            .status(400)
            .send({ error: `Shell not found: ${default_shell}` })
        }
      }

      // Validate font_size if provided
      if (font_size !== undefined && font_size !== null) {
        if (font_size < 8 || font_size > 32) {
          return reply
            .status(400)
            .send({ error: 'Font size must be between 8 and 32' })
        }
      }

      // Validate message_line_clamp if provided
      if (message_line_clamp !== undefined) {
        if (message_line_clamp < 1 || message_line_clamp > 20) {
          return reply
            .status(400)
            .send({ error: 'Message line clamp must be between 1 and 20' })
        }
      }

      const settings = updateSettings({
        default_shell,
        font_size,
        show_thinking,
        show_tool_output,
        message_line_clamp,
      })
      return settings
    },
  )
}
