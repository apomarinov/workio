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
    title: '❌ Check Failed',
    body: `${d.checkName || 'CI'} - ${d.prTitle}`,
  }),
  checks_passed: (d) => ({
    title: '✅ All Checks Passed',
    body: `${d.prTitle}`,
  }),
  changes_requested: (d) => ({
    title: '🔄 Changes Requested',
    body: `${d.reviewer} on ${d.prTitle}`,
  }),
  pr_approved: (d) => ({
    title: '✅ Approved',
    body: `${d.approver ? `${d.approver} approved ${d.prTitle}` : `${d.prTitle}`}`,
  }),
  new_comment: (d) => ({
    title: `💬 ${d.author || 'Someone'}`,
    body: `${d.body || d.prTitle}`,
  }),
  new_review: (d) => ({
    title: `👁️ ${d.author || 'Someone'}`,
    body: `${d.body || d.prTitle}`,
  }),
  review_requested: (d) => ({
    title: '👀 Review Requested',
    body: `${d.author} wants your review on ${d.prTitle}`,
  }),
  pr_mentioned: (d) => ({
    title: '💬 Mentioned',
    body: `${d.author} mentioned you in ${d.prTitle}`,
  }),
  workspace_ready: (d) => ({
    title: '✅ Workspace Ready',
    body: `${d.name || 'Workspace'} is ready`,
  }),
  workspace_failed: (d) => ({
    title: '❌ Workspace Failed',
    body: `${d.name || 'Workspace'} failed`,
  }),
  workspace_deleted: (d) => ({
    title: '✅ Workspace Deleted',
    body: `${d.name || 'Workspace'} deleted`,
  }),
  workspace_repo_failed: (d) => ({
    title: '❌ Repo Init Failed',
    body: `${d.name || 'Workspace'} repo init failed`,
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
