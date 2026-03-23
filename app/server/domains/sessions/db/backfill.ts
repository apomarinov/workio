import pool from '@server/db'
import type pg from 'pg'

export async function getSessionTranscriptPaths(encodedPath: string) {
  const { rows } = await pool.query<{ transcript_path: string }>(
    `SELECT transcript_path FROM sessions WHERE transcript_path LIKE $1`,
    [`%${encodedPath}%`],
  )
  return rows.map((r) => r.transcript_path)
}

export async function insertBackfilledSession(
  sessionId: string,
  projectId: number,
  terminalId: number,
  shellId: number,
  transcriptPath: string,
  timestamp: string | null,
  client?: pg.PoolClient,
) {
  const db = client ?? pool
  const { rowCount } = await db.query(
    timestamp
      ? `INSERT INTO sessions (session_id, project_id, terminal_id, shell_id, status, transcript_path, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ended', $5, $6, $6)
         ON CONFLICT (session_id) DO NOTHING`
      : `INSERT INTO sessions (session_id, project_id, terminal_id, shell_id, status, transcript_path)
         VALUES ($1, $2, $3, $4, 'ended', $5)
         ON CONFLICT (session_id) DO NOTHING`,
    timestamp
      ? [sessionId, projectId, terminalId, shellId, transcriptPath, timestamp]
      : [sessionId, projectId, terminalId, shellId, transcriptPath],
  )
  // Create a prompt row so worker.py's process_transcript() can attach messages
  if (rowCount && rowCount > 0) {
    await db.query(`INSERT INTO prompts (session_id) VALUES ($1)`, [sessionId])
  }
}
