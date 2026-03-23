import pool from '@server/db'
import type pg from 'pg'

export async function updateSessionMove(
  sessionId: string,
  projectId: number,
  terminalId: number,
  transcriptPath: string,
  client?: pg.PoolClient,
) {
  const db = client ?? pool
  const result = await db.query(
    `UPDATE sessions SET project_id = $1, terminal_id = $2, transcript_path = $3, updated_at = NOW() WHERE session_id = $4`,
    [projectId, terminalId, transcriptPath, sessionId],
  )
  return (result.rowCount ?? 0) > 0
}
