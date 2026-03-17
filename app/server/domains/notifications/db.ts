import { createHash } from 'node:crypto'
import pool from '@server/db'
import type { Notification } from './schema'

export async function insertNotification(
  type: string,
  repo: string | null | undefined,
  data: Record<string, unknown>,
  dedupExtra?: string,
  prNumber?: number,
) {
  const repoStr = repo ?? ''
  const dedupSource = prNumber
    ? `${type}:${repoStr}:${prNumber}${dedupExtra ? `:${dedupExtra}` : ''}`
    : `${type}:${repoStr}${dedupExtra ? `:${dedupExtra}` : ''}`
  const dedupHash = createHash('sha256')
    .update(dedupSource)
    .digest('hex')
    .substring(0, 64)

  const { rows } = await pool.query<Notification>(
    `
    INSERT INTO notifications (dedup_hash, type, repo, data)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (dedup_hash) DO NOTHING
    RETURNING *
    `,
    [dedupHash, type, repo ?? null, JSON.stringify(data)],
  )
  return rows[0]
}

export async function getNotifications(
  limit: number,
  offset: number,
  unreadOnly = false,
) {
  const whereClause = unreadOnly ? 'WHERE read = FALSE' : ''

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM notifications ${whereClause}`,
  )
  const total = Number.parseInt(countResult.rows[0].count, 10)

  const { rows } = await pool.query<Notification>(
    `
    SELECT * FROM notifications
    ${whereClause}
    ORDER BY read ASC, created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  )

  return { notifications: rows, total }
}

export async function markAllNotificationsRead() {
  await pool.query('UPDATE notifications SET read = TRUE WHERE read = FALSE')
}

export async function markNotificationRead(id: number) {
  await pool.query(
    'UPDATE notifications SET read = TRUE WHERE id = $1 AND read = FALSE',
    [id],
  )
}

export async function markNotificationUnread(id: number) {
  await pool.query(
    'UPDATE notifications SET read = FALSE WHERE id = $1 AND read = TRUE',
    [id],
  )
}

export async function markNotificationReadByItem(
  repo: string,
  prNumber: number,
  commentId?: number,
  reviewId?: number,
) {
  const conditions = ['read = FALSE', `repo = $1`, `data->>'prNumber' = $2`]
  const params: (string | number)[] = [repo, String(prNumber)]
  if (commentId) {
    params.push(String(commentId))
    conditions.push(`data->>'commentId' = $${params.length}`)
  }
  if (reviewId) {
    params.push(String(reviewId))
    conditions.push(`data->>'reviewId' = $${params.length}`)
  }
  await pool.query(
    `UPDATE notifications SET read = TRUE WHERE ${conditions.join(' AND ')}`,
    params,
  )
}

export async function markPRNotificationsRead(repo: string, prNumber: number) {
  await pool.query(
    `UPDATE notifications SET read = TRUE WHERE read = FALSE AND repo = $1 AND data->>'prNumber' = $2`,
    [repo, String(prNumber)],
  )
}

export async function deleteNotification(id: number) {
  await pool.query('DELETE FROM notifications WHERE id = $1', [id])
}

export async function deleteAllNotifications() {
  await pool.query('DELETE FROM notifications')
}

export async function getUnreadPRNotifications() {
  const { rows } = await pool.query<{
    repo: string
    prNumber: number
    type: string
    commentId: number | null
    reviewId: number | null
  }>(`
    SELECT repo, data->'prNumber' as "prNumber", type,
           data->'commentId' as "commentId", data->'reviewId' as "reviewId"
    FROM notifications
    WHERE read = FALSE AND data->'prNumber' IS NOT NULL
  `)
  return rows
}
