import type { PushSubscriptionRecord } from '@domains/settings/schema'
import type { FastifyInstance } from 'fastify'
import { getOrCreateVapidKeys, getSettings, updateSettings } from '../db'
import { sendPushNotification } from '../push'

export default async function settingsRoutes(fastify: FastifyInstance) {
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

  fastify.post('/api/push/test', async (_req, reply) => {
    const result = await sendPushNotification(
      {
        title: 'WorkIO Test',
        body: 'Push notifications are working!',
        tag: 'test',
        data: { type: 'test' },
      },
      { force: true },
    )
    if (!result.success) {
      return reply.status(500).send({ ok: false, error: result.error })
    }
    return { ok: true }
  })

  fastify.post('/api/push/test-dismiss', async () => {
    await sendPushNotification(
      {
        title: '',
        body: '',
        tag: 'test',
        action: 'dismiss',
      },
      { force: true },
    )
    return { ok: true }
  })
}
