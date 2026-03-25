import type { SessionSearchMatch } from '@domains/sessions/schema'
import pool from '@server/db'

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
