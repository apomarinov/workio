import { getSettings, updateSettings } from '@domains/settings/db'
import { getIO } from '@server/io'
import { log } from '@server/logger'
import webPush from 'web-push'
import { insertNotification } from './db'
import { NOTIFICATION_REGISTRY, resolveNotification } from './registry'

// --- Push delivery state ---

let initialized = false
let lastActiveAt = 0

const ACTIVE_TIMEOUT_MS = 60_000

// Only desktop (non-push) clients report activity. When the user is active
// on their main device, push notifications are suppressed for all devices.
// Mobile/push clients never report activity so they don't accidentally
// suppress the push notifications meant for them.
export function markDesktopActive() {
  lastActiveAt = Date.now()
}

export async function getOrCreateVapidKeys() {
  const settings = await getSettings()
  if (settings.vapid_public_key && settings.vapid_private_key) {
    return {
      publicKey: settings.vapid_public_key,
      privateKey: settings.vapid_private_key,
    }
  }
  const keys = webPush.generateVAPIDKeys()
  await updateSettings({
    vapid_public_key: keys.publicKey,
    vapid_private_key: keys.privateKey,
  })
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}

export async function initWebPush() {
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
) {
  if (!initialized) {
    log.info('[push] Not initialized, skipping')
    return 'Not initialized'
  }

  if (!options?.force && Date.now() - lastActiveAt < ACTIVE_TIMEOUT_MS) {
    log.info(
      `[push] desktop last active ${Date.now() - lastActiveAt}/${ACTIVE_TIMEOUT_MS}`,
    )
    return 'Desktop Active'
  }

  const settings = await getSettings()
  const subscriptions = settings.push_subscriptions
  if (!subscriptions || subscriptions.length === 0) return 'No Subscriptions'

  const expiredEndpoints: string[] = []
  const failures: { endpoint: string; error: Error }[] = []

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
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
    const remaining = subscriptions.filter((s) => !expiredSet.has(s.endpoint))
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
    return detail.map((d) => d.error).join('; ')
  }
}

// --- Notification emission ---

export async function emitNotification(
  type: string,
  repo: string | undefined,
  data: Record<string, unknown>,
  dedupExtra?: string,
  prNumber?: number,
) {
  const notification = await insertNotification(
    type,
    repo,
    data,
    dedupExtra,
    prNumber,
  )
  if (!notification) return

  const io = getIO()
  io?.emit('notifications:new', notification)

  if (NOTIFICATION_REGISTRY[type]) {
    const resolved = resolveNotification(type, data)
    const title = `${resolved.emoji} ${resolved.title}`
    let { body } = resolved

    // For comments/reviews, build OS body with truncated prTitle + body
    if (type === 'new_comment' || type === 'new_review') {
      const prLabel = data.prNumber ? `#${data.prNumber}` : ''
      body = data.body ? `${prLabel}\n${data.body}` : prLabel
    }

    // Check status notifications share a PR-scoped tag so they replace each other
    const tag =
      (type === 'checks_passed' || type === 'check_failed') && repo && prNumber
        ? `pr-checks:${repo}#${prNumber}`
        : (notification.dedup_hash ?? undefined)

    sendPushNotification({
      title,
      body,
      tag,
      data: { type, repo, prNumber, ...data },
    })
  }
}
