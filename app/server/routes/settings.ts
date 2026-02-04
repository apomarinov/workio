import { execFile } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import type { Settings } from '../../src/types'
import { getAllTerminals, getSettings, updateSettings } from '../db'

type UpdateSettingsBody = Partial<Omit<Settings, 'id'>>

export default async function settingsRoutes(fastify: FastifyInstance) {
  // Get settings
  fastify.get('/api/settings', async () => {
    const settings = await getSettings()
    const terminals = await getAllTerminals()

    const repoWebhooks = settings.repo_webhooks ?? {}

    // Get repos from terminals
    const terminalRepos = new Set<string>()
    for (const terminal of terminals) {
      const repo = (terminal.git_repo as { repo?: string } | null)?.repo
      if (repo) {
        terminalRepos.add(repo)
      }
    }

    // Count missing webhooks (webhooks marked as missing for repos in terminals)
    let missingWebhookCount = 0
    for (const repo of terminalRepos) {
      const webhook = repoWebhooks[repo]
      if (webhook?.missing) {
        missingWebhookCount++
      }
    }

    // Count orphaned webhooks (webhooks for repos not in any terminal)
    let orphanedWebhookCount = 0
    for (const repo of Object.keys(repoWebhooks)) {
      if (!terminalRepos.has(repo)) {
        orphanedWebhookCount++
      }
    }

    return {
      ...settings,
      missingWebhookCount,
      orphanedWebhookCount,
    }
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
        const shellExists = await new Promise<boolean>((resolve) => {
          execFile(
            'sh',
            ['-c', `command -v ${updates.default_shell}`],
            (err) => {
              resolve(!err)
            },
          )
        })
        if (!shellExists) {
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
