import pool from '@server/db'
import { buildSetClauses } from '@server/lib/db'
import { log } from '@server/logger'
import type { Shell } from '../schema'

export async function createShell(terminalId: number, name = 'main') {
  const { rows } = await pool.query<Shell>(
    `INSERT INTO shells (terminal_id, name) VALUES ($1, $2) RETURNING *`,
    [terminalId, name],
  )
  return rows[0]
}

export async function getShellById(id: number) {
  const { rows } = await pool.query<Shell>(
    'SELECT * FROM shells WHERE id = $1',
    [id],
  )
  return rows[0]
}

export async function getMainShellForTerminal(terminalId: number) {
  const { rows } = await pool.query<Shell>(
    'SELECT * FROM shells WHERE terminal_id = $1 ORDER BY id LIMIT 1',
    [terminalId],
  )
  return rows[0]
}

export async function deleteShell(id: number) {
  const result = await pool.query('DELETE FROM shells WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

export async function updateShellName(id: number, name: string) {
  const { rows } = await pool.query<Shell>(
    'UPDATE shells SET name = $1 WHERE id = $2 RETURNING *',
    [name, id],
  )
  return rows[0]
}

export async function updateShell(
  id: number,
  updates: { active_cmd?: string | null },
) {
  try {
    const set = buildSetClauses(
      { active_cmd: updates.active_cmd },
      { updatedAt: false },
    )
    if (!set) return

    set.values.push(id)
    await pool.query(
      `UPDATE shells SET ${set.sql} WHERE id = $${set.nextParam}`,
      set.values,
    )
  } catch (err) {
    log.error({ err, shellId: id }, '[db] Failed to update shell')
  }
}
