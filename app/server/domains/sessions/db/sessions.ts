import type { SessionWithProject } from '@domains/sessions/schema'
import pool from '@server/db'
import { buildSetClauses } from '@server/lib/db'

const SESSION_SELECT = `
  SELECT
    s.*,
    p.path as project_path,
    (
      SELECT pr.prompt FROM prompts pr
      WHERE pr.session_id = s.session_id AND pr.prompt IS NOT NULL
      ORDER BY pr.created_at DESC LIMIT 1
    ) as latest_user_message,
    (
      SELECT m.body FROM messages m
      JOIN prompts pr ON m.prompt_id = pr.id
      WHERE pr.session_id = s.session_id
        AND m.is_user = false
        AND m.tools IS NULL
      ORDER BY m.created_at DESC LIMIT 1
    ) as latest_agent_message
  FROM sessions s
  JOIN projects p ON s.project_id = p.id
`

export async function getAllSessions() {
  const { rows } = await pool.query<SessionWithProject>(
    `${SESSION_SELECT} ORDER BY s.updated_at DESC`,
  )
  return rows
}

export async function getSessionById(sessionId: string) {
  const { rows } = await pool.query<SessionWithProject>(
    `${SESSION_SELECT} WHERE s.session_id = $1`,
    [sessionId],
  )
  return rows[0] as SessionWithProject | undefined
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string },
) {
  const set = buildSetClauses({ name: updates.name })
  if (!set) return true

  set.values.push(sessionId)
  const result = await pool.query(
    `UPDATE sessions SET ${set.sql} WHERE session_id = $${set.nextParam}`,
    set.values,
  )
  return (result.rowCount ?? 0) > 0
}

export async function updateSessionData(
  sessionId: string,
  data: Record<string, unknown>,
) {
  const result = await pool.query(
    `UPDATE sessions SET data = COALESCE(data, '{}'::jsonb) || $1::jsonb WHERE session_id = $2`,
    [JSON.stringify(data), sessionId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function setActiveSessionDone(shellId: number) {
  const { rows } = await pool.query<{ session_id: string }>(
    `UPDATE sessions SET status = 'done', updated_at = NOW()
     WHERE shell_id = $1 AND status in ('permission_needed', 'active')
     RETURNING session_id`,
    [shellId],
  )
  return rows[0]?.session_id ?? null
}

export async function resumePermissionSession(shellId: number) {
  const { rows } = await pool.query<{ session_id: string }>(
    `UPDATE sessions SET status = 'active', updated_at = NOW()
     WHERE shell_id = $1 AND status = 'permission_needed'
     RETURNING session_id`,
    [shellId],
  )
  return rows[0]?.session_id ?? null
}

async function deleteSessionCascade(sessionIds: string[]) {
  if (sessionIds.length === 0) return 0

  // Delete in order: messages (via prompts), prompts, hooks, then sessions
  const promptResult = await pool.query(
    'SELECT id FROM prompts WHERE session_id = ANY($1)',
    [sessionIds],
  )
  if (promptResult.rows.length > 0) {
    const ids = promptResult.rows.map((p: { id: number }) => p.id)
    await pool.query('DELETE FROM messages WHERE prompt_id = ANY($1)', [ids])
  }
  await pool.query('DELETE FROM prompts WHERE session_id = ANY($1)', [
    sessionIds,
  ])
  await pool.query('DELETE FROM hooks WHERE session_id = ANY($1)', [sessionIds])
  const result = await pool.query(
    'DELETE FROM sessions WHERE session_id = ANY($1)',
    [sessionIds],
  )
  return result.rowCount ?? 0
}

export async function deleteSession(sessionId: string) {
  return (await deleteSessionCascade([sessionId])) > 0
}

export async function getOldSessionIds(weeks: number, excludeIds: string[]) {
  const { rows } = await pool.query<{ session_id: string }>(
    `SELECT session_id FROM sessions
     WHERE updated_at < NOW() - INTERVAL '1 week' * $1
       AND session_id != ALL($2)`,
    [weeks, excludeIds],
  )
  return rows.map((r) => r.session_id)
}

export async function deleteSessions(sessionIds: string[]) {
  return deleteSessionCascade(sessionIds)
}
