import { execFile } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import type { PushSubscriptionRecord, Settings } from '../../src/types'
import {
  getAllTerminals,
  getOrCreateVapidKeys,
  getSettings,
  updateSettings,
} from '../db'
import { refreshPRChecks } from '../github/checks'
import { sendPushNotification } from '../push'

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

      // Refresh PR checks when hidden_prs changes to update the filtered list
      if (updates.hidden_prs !== undefined) {
        refreshPRChecks(true)
      }

      return settings
    },
  )

  // Push notification routes

  fastify.get('/api/push/vapid-key', async () => {
    const { publicKey } = await getOrCreateVapidKeys()
    return { publicKey }
  })

  fastify.post<{
    Body: {
      endpoint: string
      keys: { p256dh: string; auth: string }
      userAgent?: string
    }
  }>('/api/push/subscribe', async (request) => {
    const { endpoint, keys, userAgent } = request.body
    const settings = await getSettings()
    const existing = settings.push_subscriptions ?? []

    // Upsert by endpoint
    const filtered = existing.filter(
      (s: PushSubscriptionRecord) => s.endpoint !== endpoint,
    )
    const newSub: PushSubscriptionRecord = {
      endpoint,
      keys,
      userAgent,
      created_at: new Date().toISOString(),
    }
    await updateSettings({ push_subscriptions: [...filtered, newSub] })
    return { ok: true }
  })

  fastify.post<{
    Body: { endpoint: string }
  }>('/api/push/unsubscribe', async (request) => {
    const { endpoint } = request.body
    const settings = await getSettings()
    const existing = settings.push_subscriptions ?? []
    const filtered = existing.filter(
      (s: PushSubscriptionRecord) => s.endpoint !== endpoint,
    )
    await updateSettings({ push_subscriptions: filtered })
    return { ok: true }
  })

  fastify.post('/api/push/test', async () => {
    await sendPushNotification(
      {
        title: 'WorkIO Test',
        body: 'Push notifications are working!',
        data: { type: 'test' },
      },
      { force: true },
    )
    return { ok: true }
  })
}
