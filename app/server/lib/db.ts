import pool from '@server/db'
import type pg from 'pg'

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export function buildSetClauses(
  fields: Record<string, unknown>,
  opts?: { updatedAt?: boolean },
): { sql: string; values: unknown[]; nextParam: number } | null {
  const clauses: string[] = []
  const values: unknown[] = []
  let paramIdx = 1

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      clauses.push(`${key} = $${paramIdx++}`)
      values.push(value)
    }
  }

  if (clauses.length === 0) return null

  if (opts?.updatedAt !== false) {
    clauses.push('updated_at = NOW()')
  }

  return { sql: clauses.join(', '), values, nextParam: paramIdx }
}

export function jsonOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  return v ? JSON.stringify(v) : null
}
