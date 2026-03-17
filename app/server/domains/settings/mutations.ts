import { refreshPRChecks } from '../../github/checks'
import { execFileAsync } from '../../lib/exec'
import { sendPushNotification } from '../../push'
import { publicProcedure } from '../../trpc/init'
import { getSettings, updateSettings } from './db'
import type { PushSubscriptionRecord } from './schema'
import {
  pushSubscribeInput,
  pushUnsubscribeInput,
  updateSettingsInput,
} from './schema'

export const update = publicProcedure
  .input(updateSettingsInput)
  .mutation(async ({ input }) => {
    // Verify shell exists if provided (filesystem check, can't be in Zod)
    if (input.default_shell) {
      const shellExists = await execFileAsync('sh', [
        '-c',
        `command -v ${input.default_shell}`,
      ]).then(
        () => true,
        () => false,
      )
      if (!shellExists) {
        throw new Error(`Shell not found: ${input.default_shell}`)
      }
    }

    const settings = await updateSettings(input)

    // Refresh PR checks when hidden_prs changes
    if (input.hidden_prs !== undefined) {
      refreshPRChecks(true)
    }

    return settings
  })

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
    throw new Error(result.error || 'Push notification failed')
  }
})

export const pushTestDismiss = publicProcedure.mutation(async () => {
  await sendPushNotification(
    {
      title: '',
      body: '',
      tag: 'test',
      action: 'dismiss',
    },
    { force: true },
  )
})
