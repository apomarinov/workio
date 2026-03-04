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
): Promise<{ success: boolean; error?: string }> {
  if (!initialized) return { success: false, error: 'Push not initialized' }
  if (!options?.force && isDesktopActive())
    return { success: false, error: 'Desktop active' }

  const settings = await getSettings()
  const subscriptions = settings.push_subscriptions
  if (!subscriptions || subscriptions.length === 0)
    return { success: false, error: 'No subscriptions' }

  const expiredEndpoints: string[] = []
  const failures: { endpoint: string; error: Error }[] = []

  await Promise.allSettled(
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
        } else {
          failures.push({
            endpoint: sub.endpoint,
            error: err instanceof Error ? err : new Error(String(err)),
          })
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
    log.info(
      `[push] Removed ${expiredEndpoints.length} expired subscription(s)`,
    )
  }

  if (failures.length > 0) {
    const detail = failures.map((f) => ({
      endpoint: f.endpoint.slice(0, 60),
      error: f.error.message,
    }))
    log.error(
      { payload, failures: detail },
      `[push] ${failures.length}/${subscriptions.length} subscription(s) failed`,
    )
    return { success: false, error: detail.map((d) => d.error).join('; ') }
  }

  return { success: true }
}
