import {
  NOTIFICATION_REGISTRY,
  resolveNotification,
} from '../shared/notifications'
import { insertNotification } from './db'
import { getIO } from './io'
import { sendPushNotification } from './push'

export async function emitNotification(
  type: string,
  repo: string | undefined,
  data: Record<string, unknown>,
  dedupExtra?: string,
  prNumber?: number,
): Promise<void> {
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
