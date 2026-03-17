import { publicProcedure } from '../../trpc/init'
import { getSettings } from './db'
import { getOrCreateVapidKeys } from './service'

export const get = publicProcedure.query(getSettings)

export const vapidKey = publicProcedure.query(getOrCreateVapidKeys)
