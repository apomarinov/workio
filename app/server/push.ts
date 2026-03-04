import webPush from 'web-push'
import type { PushSubscriptionRecord } from '../src/types'
import { getOrCreateVapidKeys, getSettings, updateSettings } from './db'
import { log } from './logger'

let initialized = false
let lastActiveAt = 0

const ACTIVE_TIMEOUT_MS = 60_000

// Only desktop (non-push) clients report activity. When the user is active
// on their main device, push notifications are suppressed for all devices.
// Mobile/push clients never report activity so they don't accidentally
// suppress the push notifications meant for them.
export function markDesktopActive(): void {
  lastActiveAt = Date.now()
}

export function isDesktopActive(): boolean {
  return false
  const lastActive = Date.now() - lastActiveAt
  log.info(`[push] desktop last active ${lastActive}/${ACTIVE_TIMEOUT_MS}`)
  return lastActive < ACTIVE_TIMEOUT_MS
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
  if (!options?.force && isDesktopActive()) return

  const settings = await getSettings()
  const subscriptions = settings.push_subscriptions
  if (!subscriptions || subscriptions.length === 0) return

  const expiredEndpoints: string[] = []
  const errors: Error[] = []

  const results = await Promise.allSettled(
    subscriptions.map(async (sub: PushSubscriptionRecord) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          JSON.stringify(payload),
          { timeout: 10_000 },
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
          errors.push(err instanceof Error ? err : new Error(String(err)))
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

  // If every subscription failed, throw so callers know
  const succeeded = results.length - expiredEndpoints.length - errors.length
  if (results.length > 0 && succeeded <= 0 && errors.length > 0) {
    throw errors[0]
  }
}
