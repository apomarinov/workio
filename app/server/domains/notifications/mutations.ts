import { getSettings, updateSettings } from '@domains/settings/db'
import type { PushSubscriptionRecord } from '@domains/settings/schema'
import { getShellById } from '@domains/workspace/db/shells'
import { getTerminalById } from '@domains/workspace/db/terminals'
import { getIO } from '@server/io'
import { log } from '@server/logger'
import { publicProcedure } from '@server/trpc'
import {
  deleteAllNotifications,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationReadByItem,
  markNotificationUnread,
  markPRNotificationsRead,
} from './db'
import {
  idInput,
  markItemReadInput,
  markPRReadInput,
  pushSubscribeInput,
  pushUnsubscribeInput,
  sendCustomInput,
} from './schema'
import { sendPushNotification } from './service'

export const send = publicProcedure
  .input(sendCustomInput)
  .mutation(async ({ input }) => {
    const { title, body, terminalId, shellId } = input

    let terminalName: string | undefined
    let shellLabel: string | undefined

    if (terminalId) {
      const terminal = await getTerminalById(terminalId)
      if (terminal) terminalName = terminal.name || undefined
    }

    if (shellId) {
      const shell = await getShellById(shellId)
      if (shell) shellLabel = shell.active_cmd || shell.name || undefined
    }

    // Build body with terminal/shell context
    const contextParts: string[] = []
    if (terminalName) contextParts.push(terminalName)
    if (shellLabel) contextParts.push(shellLabel)
    const enrichedBody = contextParts.length
      ? `[${contextParts.join(' › ')}] ${body}`
      : body

    // Emit to web clients via a dedicated event (avoids DB-backed notification flow)
    getIO()?.emit('notification:custom', { title, body: enrichedBody })

    const tag = shellId
      ? `shell:${shellId}`
      : terminalId
        ? `terminal:${terminalId}`
        : 'custom-noti'

    sendPushNotification(
      { title: `📣 ${title}`, body: enrichedBody, tag },
      { force: true },
    ).catch((err) =>
      log.error({ err }, 'Failed to send custom push notification'),
    )
  })

export const markAllRead = publicProcedure.mutation(() =>
  markAllNotificationsRead(),
)

export const markPRRead = publicProcedure
  .input(markPRReadInput)
  .mutation(({ input }) => markPRNotificationsRead(input.repo, input.prNumber))

export const markItemRead = publicProcedure
  .input(markItemReadInput)
  .mutation(({ input }) =>
    markNotificationReadByItem(
      input.repo,
      input.prNumber,
      input.commentId,
      input.reviewId,
    ),
  )

export const markRead = publicProcedure
  .input(idInput)
  .mutation(({ input }) => markNotificationRead(input.id))

export const markUnread = publicProcedure
  .input(idInput)
  .mutation(({ input }) => markNotificationUnread(input.id))

export const remove = publicProcedure
  .input(idInput)
  .mutation(({ input }) => deleteNotification(input.id))

export const removeAll = publicProcedure.mutation(() =>
  deleteAllNotifications(),
)

export const pushSubscribe = publicProcedure
  .input(pushSubscribeInput)
  .mutation(async ({ input }) => {
    const settings = await getSettings()
    const existing = settings.push_subscriptions ?? []
    const filtered = existing.filter((s) => s.endpoint !== input.endpoint)
    const newSub: PushSubscriptionRecord = {
      endpoint: input.endpoint,
      keys: input.keys,
      userAgent: input.userAgent,
      created_at: new Date().toISOString(),
    }
    await updateSettings({ push_subscriptions: [...filtered, newSub] })
  })

export const pushUnsubscribe = publicProcedure
  .input(pushUnsubscribeInput)
  .mutation(async ({ input }) => {
    const settings = await getSettings()
    const existing = settings.push_subscriptions ?? []
    const filtered = existing.filter((s) => s.endpoint !== input.endpoint)
    await updateSettings({ push_subscriptions: filtered })
  })

export const pushTest = publicProcedure.mutation(async () => {
  const error = await sendPushNotification(
    {
      title: 'WorkIO Test',
      body: 'Push notifications are working!',
      tag: 'test',
      data: { type: 'test' },
    },
    { force: true },
  )
  if (error) throw new Error(error)
})

export const pushTestDismiss = publicProcedure.mutation(() =>
  sendPushNotification(
    { title: '', body: '', tag: 'test', action: 'dismiss' },
    { force: true },
  ),
)
