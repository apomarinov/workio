import { publicProcedure } from '../../trpc/init'
import { getSettings } from './db'
import { getOrCreateVapidKeys } from './service'

// TODO: move webhook count logic (missingWebhookCount, orphanedWebhookCount)
// to the client — it combines settings.repo_webhooks with terminals data
// and is purely a UI concern
export const get = publicProcedure.query(getSettings)
export const vapidKey = publicProcedure.query(getOrCreateVapidKeys)
