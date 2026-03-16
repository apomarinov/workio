import * as api from './api'

export const UNREAD_PR_KEY = '/api/notifications/pr-unread'

export type UnreadPREntry = { count: number; itemIds: string[] }
export type UnreadPRData = Record<string, UnreadPREntry>

export const EMPTY_UNREAD: UnreadPRData = {}

export async function fetchUnreadPRData(): Promise<UnreadPRData> {
  const data = await api.getUnreadPRNotifications()
  const result: UnreadPRData = {}
  for (const item of data) {
    const key = `${item.repo}#${item.prNumber}`
    const itemIds: string[] = []
    for (const i of item.items) {
      if (i.commentId) itemIds.push(String(i.commentId))
      if (i.reviewId) itemIds.push(String(i.reviewId))
    }
    result[key] = { count: item.count, itemIds }
  }
  return result
}
