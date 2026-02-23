import { insertNotification } from './db'
import { getIO } from './io'
import { sendPushNotification } from './push'

const TYPE_TO_PUSH: Record<
  string,
  (data: Record<string, unknown>) => { title: string; body: string }
> = {
  pr_merged: (d) => ({
    title: 'PR Merged',
    body: `${d.prTitle}`,
  }),
  pr_closed: (d) => ({
    title: 'PR Closed',
    body: `${d.prTitle}`,
  }),
  check_failed: (d) => ({
    title: 'Check Failed',
    body: `${d.checkName || 'CI'} failed on ${d.prTitle}`,
  }),
  checks_passed: (d) => ({
    title: 'Checks Passed',
    body: `All checks passed on ${d.prTitle}`,
  }),
  changes_requested: (d) => ({
    title: 'Changes Requested',
    body: `${d.reviewer} requested changes on ${d.prTitle}`,
  }),
  pr_approved: (d) => ({
    title: 'PR Approved',
    body: `${d.approver} approved ${d.prTitle}`,
  }),
  new_comment: (d) => ({
    title: 'New Comment',
    body: `${d.author} commented on ${d.prTitle}`,
  }),
  new_review: (d) => ({
    title: 'New Review',
    body: `${d.author} reviewed ${d.prTitle}`,
  }),
  workspace_ready: (d) => ({
    title: 'Workspace Ready',
    body: `${d.name || 'Workspace'} is ready`,
  }),
  workspace_failed: (d) => ({
    title: 'Workspace Failed',
    body: `${d.name || 'Workspace'} setup failed`,
  }),
  workspace_deleted: (d) => ({
    title: 'Workspace Deleted',
    body: `${d.name || 'Workspace'} was deleted`,
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
      data: { type, repo, prNumber, ...data },
    })
  }
}
