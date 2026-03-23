import pool from '@server/db'
import { buildSetClauses } from '@server/lib/db'
import type { SessionSearchMatch, SessionWithProject } from './schema'

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

// --- Messages ---

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

  const { rows } = await pool.query<SessionMessageRow>(
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
  if (ids.length === 0) return [] as SessionMessageRow[]

  const { rows } = await pool.query<SessionMessageRow>(
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
  const { rows } = await pool.query<SessionMessageRow>(
    `${MESSAGE_SELECT} WHERE m.uuid = $1`,
    [uuid],
  )
  return rows[0] ?? null
}

// Row type for query results — matches sessionMessageSchema shape
type SessionMessageRow = {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  todo_id: string | null
  body: string | null
  tools: Record<string, unknown> | null
  images: unknown[] | null
  created_at: string
  updated_at: string | null
  prompt_text: string | null
}

// --- Search ---

export async function searchSessionMessages(
  query: string | null,
  limit = 100,
  filters?: { repo?: string; branch?: string },
  recentOnly = true,
) {
  const hasTextQuery = query != null && query.length >= 2
  const hasFilters = filters?.repo != null && filters?.branch != null

  if (!hasTextQuery && !hasFilters) return [] as SessionSearchMatch[]

  // Build optional containment filter fragment
  const containmentParam: string[] = []
  if (hasFilters) {
    const containment: Record<string, string> = {
      repo: filters.repo!,
      branch: filters.branch!,
    }
    containmentParam.push(JSON.stringify([containment]))
  }

  const recentClause = recentOnly
    ? `s.updated_at >= NOW() - INTERVAL '10 days'`
    : ''

  type SessionRow = {
    session_id: string
    name: string | null
    status: string
    terminal_id: number | null
    updated_at: string
    data: Record<string, unknown> | null
    project_path: string
    terminal_name: string | null
  }

  // Filter-only: single query on sessions
  if (!hasTextQuery) {
    const conditions = [`s.data->'branches' @> $1::jsonb`]
    if (recentClause) conditions.push(recentClause)
    const { rows } = await pool.query<SessionRow>(
      `
      SELECT s.session_id, s.name, s.status, s.terminal_id, s.updated_at, s.data,
             p.path as project_path, t.name as terminal_name
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN terminals t ON s.terminal_id = t.id
      WHERE ${conditions.join(' AND ')}
      `,
      containmentParam,
    )
    return buildSearchResults(rows, new Map())
  }

  // Text search: 2 queries in parallel
  // Query 1: message body ILIKE + session info (+ optional containment filter)
  const msgConditions = [
    'm.body ILIKE $1',
    'm.thinking = false',
    'm.body IS NOT NULL',
  ]
  if (recentClause) msgConditions.push(recentClause)
  const msgParams: unknown[] = [`%${query}%`, limit]
  let msgParamIdx = 3
  if (hasFilters) {
    msgConditions.push(`s.data->'branches' @> $${msgParamIdx++}::jsonb`)
    msgParams.push(containmentParam[0])
  }

  // Query 2: session name/branch ILIKE + session info (+ optional containment filter)
  const nameConditions = [`(s.name ILIKE $1 OR s.data->>'branch' ILIKE $1)`]
  if (recentClause) nameConditions.push(recentClause)
  const nameParams: unknown[] = [`%${query}%`, limit]
  let nameParamIdx = 3
  if (hasFilters) {
    nameConditions.push(`s.data->'branches' @> $${nameParamIdx++}::jsonb`)
    nameParams.push(containmentParam[0])
  }

  const [{ rows: msgRows }, { rows: nameRows }] = await Promise.all([
    pool.query<
      SessionRow & { message_id: number; body: string; is_user: boolean }
    >(
      `
      SELECT m.id as message_id, m.body, m.is_user,
             s.session_id, s.name, s.status, s.terminal_id, s.updated_at, s.data,
             p.path as project_path, t.name as terminal_name
      FROM messages m
      JOIN prompts pr ON m.prompt_id = pr.id
      JOIN sessions s ON pr.session_id = s.session_id
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN terminals t ON s.terminal_id = t.id
      WHERE ${msgConditions.join(' AND ')}
      ORDER BY m.created_at DESC
      LIMIT $2
      `,
      msgParams,
    ),
    pool.query<SessionRow>(
      `
      SELECT s.session_id, s.name, s.status, s.terminal_id, s.updated_at, s.data,
             p.path as project_path, t.name as terminal_name
      FROM sessions s
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN terminals t ON s.terminal_id = t.id
      WHERE ${nameConditions.join(' AND ')}
      LIMIT $2
      `,
      nameParams,
    ),
  ])

  // Group messages per session (cap 5)
  const sessionMessages = new Map<
    string,
    { id: number; body: string; is_user: boolean }[]
  >()
  const sessionInfoMap = new Map<string, SessionRow>()

  for (const row of msgRows) {
    if (!sessionInfoMap.has(row.session_id))
      sessionInfoMap.set(row.session_id, row)
    const msgs = sessionMessages.get(row.session_id) || []
    if (msgs.length < 5) {
      msgs.push({ id: row.message_id, body: row.body, is_user: row.is_user })
    }
    sessionMessages.set(row.session_id, msgs)
  }

  // Merge name-matched sessions (empty messages if not already present)
  for (const row of nameRows) {
    if (!sessionInfoMap.has(row.session_id))
      sessionInfoMap.set(row.session_id, row)
    if (!sessionMessages.has(row.session_id)) {
      sessionMessages.set(row.session_id, [])
    }
  }

  return buildSearchResults([...sessionInfoMap.values()], sessionMessages)
}

function buildSearchResults(
  sessionRows: {
    session_id: string
    name: string | null
    status: string
    terminal_id: number | null
    updated_at: string
    data: Record<string, unknown> | null
    project_path: string
    terminal_name: string | null
  }[],
  sessionMessages: Map<
    string,
    { id: number; body: string; is_user: boolean }[]
  >,
): SessionSearchMatch[] {
  const results: SessionSearchMatch[] = sessionRows.map((info) => ({
    session_id: info.session_id,
    name: info.name,
    terminal_name: info.terminal_name,
    project_path: info.project_path,
    status: info.status,
    updated_at: info.updated_at,
    data: info.data ?? null,
    messages: sessionMessages.get(info.session_id) ?? [],
  }))

  results.sort((a, b) => {
    const aInfo = sessionRows.find((r) => r.session_id === a.session_id)!
    const bInfo = sessionRows.find((r) => r.session_id === b.session_id)!
    const aHasTerminal = aInfo.terminal_id != null ? 0 : 1
    const bHasTerminal = bInfo.terminal_id != null ? 0 : 1
    if (aHasTerminal !== bHasTerminal) return aHasTerminal - bHasTerminal
    return (
      new Date(bInfo.updated_at).getTime() -
      new Date(aInfo.updated_at).getTime()
    )
  })

  return results
}
