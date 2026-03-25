import type { SessionMessage } from '@domains/sessions/schema'
import pool from '@server/db'

const MESSAGE_SELECT = `
  SELECT
    m.id,
    m.prompt_id,
    m.uuid,
    m.is_user,
    m.thinking,
    m.todo_id,
    m.body,
    m.tools,
    m.images,
    m.created_at,
    m.updated_at,
    p.prompt as prompt_text
  FROM messages m
  JOIN prompts p ON m.prompt_id = p.id
`

export async function getSessionMessages(
  sessionId: string,
  limit: number,
  offset: number,
) {
  const countResult = await pool.query(
    `
      SELECT COUNT(*) as count
      FROM messages m
      JOIN prompts p ON m.prompt_id = p.id
      WHERE p.session_id = $1
    `,
    [sessionId],
  )
  const total = Number.parseInt(countResult.rows[0].count, 10)

  const { rows } = await pool.query<SessionMessage>(
    `
      ${MESSAGE_SELECT}
      WHERE p.session_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [sessionId, limit, offset],
  )

  return {
    messages: rows,
    total,
    hasMore: offset + rows.length < total,
  }
}

export async function getMessagesByIds(ids: number[]) {
  if (ids.length === 0) return [] as SessionMessage[]

  const { rows } = await pool.query<SessionMessage>(
    `
      ${MESSAGE_SELECT}
      WHERE m.id = ANY($1)
      ORDER BY m.id
    `,
    [ids],
  )
  return rows
}

export async function getMessageByUuid(uuid: string) {
  const { rows } = await pool.query<SessionMessage>(
    `${MESSAGE_SELECT} WHERE m.uuid = $1`,
    [uuid],
  )
  return rows[0] ?? null
}
