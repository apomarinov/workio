import pool from '@server/db'
import type { SessionMessage, SessionWithProject } from '../schema'

type ActivePermissionRow = SessionWithProject & {
  message_id: number
  tools: Record<string, unknown>
}

export async function getActivePermissions() {
  const { rows } = await pool.query<ActivePermissionRow>(`
    SELECT DISTINCT ON (s.session_id)
      s.*,
      proj.path as project_path,
      (
        SELECT pr2.prompt FROM prompts pr2
        WHERE pr2.session_id = s.session_id AND pr2.prompt IS NOT NULL
        ORDER BY pr2.created_at DESC LIMIT 1
      ) as latest_user_message,
      (
        SELECT m2.body FROM messages m2
        JOIN prompts pr2 ON m2.prompt_id = pr2.id
        WHERE pr2.session_id = s.session_id
          AND m2.is_user = false
          AND m2.tools IS NULL
        ORDER BY m2.created_at DESC LIMIT 1
      ) as latest_agent_message,
      m.id as message_id,
      m.tools as tools
    FROM sessions s
    JOIN projects proj ON s.project_id = proj.id
    JOIN prompts p ON p.session_id = s.session_id
    JOIN messages m ON m.prompt_id = p.id
    WHERE s.status = 'permission_needed'
      AND m.is_user = false
      AND m.tools IS NOT NULL
      AND (
        (m.tools->>'name' = 'AskUserQuestion'
          AND m.tools->'answers' IS NULL
          AND m.tools->>'status' IS DISTINCT FROM 'error')
        OR (m.tools->>'name' = 'PermissionPrompt' AND m.tools->>'status' = 'pending')
      )
      AND p.id = (
        SELECT p2.id FROM prompts p2
        WHERE p2.session_id = s.session_id
        ORDER BY p2.created_at DESC LIMIT 1
      )
      AND m.created_at >= p.created_at
    ORDER BY s.session_id, m.created_at DESC
  `)

  return rows.map((row) => ({
    ...row,
    is_favorite: false as const,
    source:
      row.tools?.name === 'AskUserQuestion'
        ? ('ask_user_question' as const)
        : ('terminal_prompt' as const),
  }))
}

export async function getLatestPromptId(sessionId: string) {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM prompts WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sessionId],
  )
  return rows[0]?.id ?? null
}

export async function insertPermissionMessage(
  promptId: number,
  uuid: string,
  toolsJson: string,
) {
  const { rows } = await pool.query(
    `INSERT INTO messages (prompt_id, uuid, is_user, thinking, tools)
     VALUES ($1, $2, FALSE, FALSE, $3)
     RETURNING *`,
    [promptId, uuid, toolsJson],
  )
  const { rows: full } = await pool.query<SessionMessage>(
    `SELECT m.*, p.prompt as prompt_text
     FROM messages m JOIN prompts p ON m.prompt_id = p.id
     WHERE m.id = $1`,
    [rows[0].id],
  )
  return full[0]
}
