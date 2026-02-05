import type { FastifyInstance } from 'fastify'
import pool from '../db'

export interface CommandLog {
  id: number
  terminal_id: number | null
  pr_id: string | null
  exit_code: number
  category: string
  data: {
    command: string
    stdout?: string
    stderr?: string
    sshHost?: string
    terminalName?: string
    prName?: string
  }
  created_at: string
}

export interface LogTerminal {
  id: number
  name: string
  deleted: boolean
}

export default async function logsRoutes(fastify: FastifyInstance) {
  // Get command logs with filters
  fastify.get<{
    Querystring: {
      terminalId?: string
      deleted?: string
      prName?: string
      category?: string
      failed?: string
      startDate?: string
      endDate?: string
      search?: string
      offset?: string
      limit?: string
    }
  }>('/api/command-logs', async (request) => {
    const {
      terminalId,
      deleted,
      prName,
      category,
      failed,
      startDate,
      endDate,
      search,
      offset = '0',
      limit = '50',
    } = request.query

    const conditions: string[] = []
    const values: (string | number)[] = []
    let paramIdx = 1

    // Filter by terminal_id
    if (terminalId) {
      conditions.push(`terminal_id = $${paramIdx++}`)
      values.push(Number(terminalId))
    }

    // Filter by deleted terminals (orphaned logs)
    if (deleted === 'true') {
      conditions.push(
        `terminal_id IS NOT NULL AND terminal_id NOT IN (SELECT id FROM terminals)`,
      )
    }

    // Filter by prName (stored directly in pr_id column)
    if (prName) {
      conditions.push(`pr_id = $${paramIdx++}`)
      values.push(prName)
    }

    // Filter by category
    if (category) {
      conditions.push(`category = $${paramIdx++}`)
      values.push(category)
    }

    // Filter by failed (exit_code = 1)
    if (failed === 'true') {
      conditions.push('exit_code = 1')
    }

    // Filter by date range
    if (startDate) {
      conditions.push(`created_at >= $${paramIdx++}`)
      values.push(startDate)
    }
    if (endDate) {
      conditions.push(`created_at <= $${paramIdx++}`)
      values.push(endDate)
    }

    // Filter by search (ILIKE on data::text)
    if (search) {
      conditions.push(`data::text ILIKE '%' || $${paramIdx++} || '%'`)
      values.push(search)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM command_logs ${whereClause}`,
      values,
    )
    const total = Number.parseInt(countResult.rows[0].count, 10)

    // Get logs with pagination
    const limitVal = Math.min(Number(limit), 100)
    const offsetVal = Number(offset)

    const { rows } = await pool.query<CommandLog>(
      `SELECT id, terminal_id, pr_id, exit_code, category, data, created_at
       FROM command_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limitVal, offsetVal],
    )

    return {
      logs: rows,
      total,
      hasMore: offsetVal + rows.length < total,
    }
  })

  // Get distinct terminal IDs with names for filter dropdown
  fastify.get('/api/command-logs/terminals', async () => {
    const { rows } = await pool.query<LogTerminal>(`
      SELECT DISTINCT ON (cl.terminal_id)
        cl.terminal_id as id,
        cl.data->>'terminalName' as name,
        (t.id IS NULL) as deleted
      FROM command_logs cl
      LEFT JOIN terminals t ON t.id = cl.terminal_id
      WHERE cl.terminal_id IS NOT NULL
      ORDER BY cl.terminal_id, cl.created_at DESC
    `)

    return { terminals: rows }
  })
}
