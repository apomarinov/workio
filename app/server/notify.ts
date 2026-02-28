import { insertNotification } from './db'
import { getIO } from './io'
import { sendPushNotification } from './push'

const TYPE_TO_PUSH: Record<
  string,
  (data: Record<string, unknown>) => { title: string; body: string }
> = {
  pr_merged: (d) => ({
    title: '✅ Merged',
    body: `${d.prTitle}`,
  }),
  pr_closed: (d) => ({
    title: '🚫 Closed',
    body: `${d.prTitle}`,
  }),
  check_failed: (d) => ({
    title: `❌ ${d.checkName || 'Check failed'}`,
    body: `${d.prTitle}`,
  }),
  checks_passed: (d) => ({
    title: '✅ All checks passed',
    body: `${d.prTitle}`,
  }),
  changes_requested: (d) => ({
    title: `🔄 ${d.reviewer || 'Changes requested'}`,
    body: `${d.prTitle}`,
  }),
  pr_approved: (d) => ({
    title: `✅ ${d.approver || 'Approved'}`,
    body: `${d.prTitle}`,
  }),
  new_comment: (d) => {
    const prTitle = String(d.prTitle || '')
    const truncatedTitle =
      prTitle.length > 50 ? `${prTitle.slice(0, 50)}…` : prTitle
    return {
      title: `💬 ${d.author || 'Someone'}`,
      body: d.body ? `${truncatedTitle}\n${d.body}` : truncatedTitle,
    }
  },
  new_review: (d) => {
    const emoji =
      d.state === 'APPROVED'
        ? '✅'
        : d.state === 'CHANGES_REQUESTED'
          ? '🔄'
          : '💬'
    const prTitle = String(d.prTitle || '')
    const truncatedTitle =
      prTitle.length > 50 ? `${prTitle.slice(0, 50)}…` : prTitle
    return {
      title: `${emoji} ${d.author || 'Someone'}`,
      body: d.body ? `${truncatedTitle}\n${d.body}` : truncatedTitle,
    }
  },
  review_requested: (d) => ({
    title: `👀 ${d.author || 'Review requested'}`,
    body: `wants your review on ${d.prTitle}`,
  }),
  pr_mentioned: (d) => ({
    title: `💬 ${d.author || 'Mentioned'}`,
    body: `mentioned you in ${d.prTitle}`,
  }),
  workspace_ready: (d) => ({
    title: `✅ ${d.name || 'Workspace'}`,
    body: 'Ready',
  }),
  workspace_failed: (d) => ({
    title: `❌ ${d.name || 'Workspace'}`,
    body: 'Failed',
  }),
  workspace_deleted: (d) => ({
    title: `✅ ${d.name || 'Workspace'}`,
    body: 'Deleted',
  }),
  workspace_repo_failed: (d) => ({
    title: `❌ ${d.name || 'Workspace'}`,
    body: 'Repo init failed',
  }),
}

export async function emitNotification(
  type: string,
  repo: string,
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

  const mapper = TYPE_TO_PUSH[type]
  if (mapper) {
    const { title, body } = mapper(data)
    sendPushNotification({
      title,
      body,
      tag: notification.dedup_hash ?? undefined,
      data: { type, repo, prNumber, ...data },
    })
  }
}
