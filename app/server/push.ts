import webPush from 'web-push'
import type { PushSubscriptionRecord } from '../src/types'
import { getOrCreateVapidKeys, getSettings, updateSettings } from './db'
import { log } from './logger'

let initialized = false
let lastActiveAt = 0

const ACTIVE_TIMEOUT_MS = 60_000

export function markUserActive(): void {
  lastActiveAt = Date.now()
}

export function isUserActive(): boolean {
  return Date.now() - lastActiveAt < ACTIVE_TIMEOUT_MS
}

export async function initWebPush(): Promise<void> {
  try {
    const { publicKey, privateKey } = await getOrCreateVapidKeys()
    webPush.setVapidDetails('mailto:push@workio.dev', publicKey, privateKey)
    initialized = true
    log.info('[push] Web Push initialized with VAPID keys')
  } catch (err) {
    log.error({ err }, '[push] Failed to initialize Web Push')
  }
}

export async function sendPushNotification(
  payload: {
    title: string
    body: string
    tag?: string
    action?: string
    data?: Record<string, unknown>
  },
  options?: { force?: boolean },
): Promise<void> {
  if (!initialized) return
  if (!options?.force && isUserActive()) return

  const settings = await getSettings()
  const subscriptions = settings.push_subscriptions
  if (!subscriptions || subscriptions.length === 0) return

  const expiredEndpoints: string[] = []

  await Promise.allSettled(
    subscriptions.map(async (sub: PushSubscriptionRecord) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          JSON.stringify(payload),
        )
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          expiredEndpoints.push(sub.endpoint)
          log.info(
            `[push] Removing expired subscription: ${sub.endpoint.slice(0, 60)}...`,
          )
        } else {
          log.error({ err }, '[push] Failed to send push notification')
        }
      }
    }),
  )

  // Remove expired subscriptions
  if (expiredEndpoints.length > 0) {
    const expiredSet = new Set(expiredEndpoints)
    const remaining = subscriptions.filter(
      (s: PushSubscriptionRecord) => !expiredSet.has(s.endpoint),
    )
    await updateSettings({ push_subscriptions: remaining })
  }
}
