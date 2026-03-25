import { publicProcedure } from '@server/trpc'
import { getNotifications, getUnreadPRNotifications } from './db'
import { listInput } from './schema'
import { getOrCreateVapidKeys } from './service'

export const vapidKey = publicProcedure.query(getOrCreateVapidKeys)

export const list = publicProcedure
  .input(listInput)
  .query(({ input }) => getNotifications(input.limit, input.offset))

export const prUnread = publicProcedure.query(async () => {
  const rows = await getUnreadPRNotifications()

  const result: Record<string, { count: number; itemIds: string[] }> = {}

  for (const row of rows) {
    const key = `${row.repo}#${row.prNumber}`
    if (!result[key]) {
      result[key] = { count: 0, itemIds: [] }
    }
    const entry = result[key]
    if (row.commentId) entry.itemIds.push(String(row.commentId))
    if (row.reviewId) entry.itemIds.push(String(row.reviewId))
    entry.count++
  }

  return result
})
