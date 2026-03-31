import pool from '@server/db'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { log } from '@server/logger'
import type {
  CommandLog,
  InfiniteListInput,
  ListInput,
  LogTerminal,
} from './schema'

interface LogCommandOptions {
  terminalId?: number
  prId?: string // "owner/repo#123" format
  category: 'git' | 'workspace' | 'github'
  command: string
  stdout?: string
  stderr?: string
  failed?: boolean
  /** When set, uses upsert: one row per key, only updates on state change (ok↔error). */
  dedupeKey?: string
}

// In-memory cache for deduped log state — avoids DB round-trip when state unchanged
const dedupeCache = new Map<string, boolean>()

/** Fire-and-forget command logging - callers do not await */
export async function logCommand(opts: LogCommandOptions) {
  try {
    const exitCode = opts.failed ? 1 : 0

    // For deduped keys, skip the DB query entirely if state hasn't changed
    if (opts.dedupeKey) {
      const failed = !!opts.failed
      const prev = dedupeCache.get(opts.dedupeKey)
      if (failed === (prev ?? false)) return
      dedupeCache.set(opts.dedupeKey, failed)
    }

    // If not failed, combine stderr into stdout (git often outputs progress to stderr)
    let stdout = opts.stdout ?? ''
    let stderr: string | undefined
    if (opts.failed) {
      stderr = opts.stderr
    } else if (opts.stderr) {
      stdout = stdout ? `${stdout}\n${opts.stderr}` : opts.stderr
    }

    const data = JSON.stringify({
      command: opts.command,
      stdout: stdout.substring(0, 10000) || undefined,
      stderr: stderr?.substring(0, 5000),
    })

    let row: CommandLog | undefined

    if (opts.dedupeKey) {
      // Upsert: insert first time, then only update when exit_code changes
      const result = await pool.query<CommandLog>(
        `INSERT INTO command_logs (terminal_id, pr_id, exit_code, category, data, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
         DO UPDATE SET exit_code = EXCLUDED.exit_code, data = EXCLUDED.data,
                       terminal_id = EXCLUDED.terminal_id, created_at = NOW()
         WHERE command_logs.exit_code != EXCLUDED.exit_code
         RETURNING id, terminal_id, (SELECT name FROM terminals WHERE id = terminal_id) as terminal_name, pr_id, exit_code, category, data, created_at`,
        [
          opts.terminalId ?? null,
          opts.prId ?? null,
          exitCode,
          opts.category,
          data,
          opts.dedupeKey,
        ],
      )
      row = result.rows[0]
    } else {
      const result = await pool.query<CommandLog>(
        `INSERT INTO command_logs (terminal_id, pr_id, exit_code, category, data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, terminal_id, (SELECT name FROM terminals WHERE id = terminal_id) as terminal_name, pr_id, exit_code, category, data, created_at`,
        [
          opts.terminalId ?? null,
          opts.prId ?? null,
          exitCode,
          opts.category,
          data,
        ],
      )
      row = result.rows[0]
    }

    if (row) {
      getIO()?.emit('log:created', row)
    }
  } catch (err) {
    log.error(
      { err, terminalId: opts.terminalId, prId: opts.prId },
      '[command_logs] Failed to log',
    )
  }
}

export async function getCommandLogs(input: ListInput) {
  const conditions: string[] = []
  const values: (string | number)[] = []
  let paramIdx = 1

  if (input.terminalId) {
    conditions.push(`terminal_id = $${paramIdx++}`)
    values.push(input.terminalId)
  }

  if (input.deleted) {
    conditions.push(
      `terminal_id IS NOT NULL AND terminal_id NOT IN (SELECT id FROM terminals)`,
    )
  }

  if (input.prName) {
    conditions.push(`pr_id = $${paramIdx++}`)
    values.push(input.prName)
  }

  if (input.category) {
    conditions.push(`category = $${paramIdx++}`)
    values.push(input.category)
  }

  if (input.failed) {
    conditions.push('exit_code = 1')
  }

  if (input.startDate) {
    conditions.push(`created_at >= $${paramIdx++}`)
    values.push(input.startDate)
  }
  if (input.endDate) {
    conditions.push(`created_at <= $${paramIdx++}`)
    values.push(input.endDate)
  }

  if (input.search) {
    conditions.push(`data::text ILIKE '%' || $${paramIdx++} || '%'`)
    values.push(input.search)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM command_logs ${whereClause}`,
    values,
  )
  const total = Number.parseInt(countResult.rows[0].count, 10)

  const { rows } = await pool.query<CommandLog>(
    `SELECT id, terminal_id, pr_id, exit_code, category, data, created_at
     FROM command_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, input.limit, input.offset],
  )

  return {
    logs: rows,
    total,
    hasMore: input.offset + rows.length < total,
  }
}

function buildLogFilters(input: InfiniteListInput, alias = '') {
  const p = alias ? `${alias}.` : ''
  const conditions: string[] = []
  const values: (string | number)[] = []
  let paramIdx = 1

  if (input.cursor) {
    conditions.push(`${p}id < $${paramIdx++}`)
    values.push(input.cursor)
  }

  if (input.system) {
    conditions.push(`${p}terminal_id IS NULL`)
  } else if (input.terminalId) {
    conditions.push(`${p}terminal_id = $${paramIdx++}`)
    values.push(input.terminalId)
  }

  if (input.deleted) {
    conditions.push(
      `${p}terminal_id IS NOT NULL AND ${p}terminal_id NOT IN (SELECT id FROM terminals)`,
    )
  }

  if (input.prName) {
    conditions.push(`${p}pr_id = $${paramIdx++}`)
    values.push(input.prName)
  }

  if (input.category) {
    conditions.push(`${p}category = $${paramIdx++}`)
    values.push(input.category)
  }

  if (input.failed) {
    conditions.push(`${p}exit_code = 1`)
  }

  if (input.search) {
    conditions.push(`${p}data::text ILIKE '%' || $${paramIdx++} || '%'`)
    values.push(input.search)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return { conditions, values, paramIdx, whereClause }
}

export async function getCommandLogsInfinite(input: InfiniteListInput) {
  const {
    values,
    paramIdx: nextIdx,
    whereClause,
  } = buildLogFilters(input, 'cl')
  let paramIdx = nextIdx

  // Fetch limit+1 to determine if there are more items
  const fetchLimit = input.limit + 1
  const { rows } = await pool.query<CommandLog>(
    `SELECT cl.id, cl.terminal_id, t.name as terminal_name, cl.pr_id, cl.exit_code, cl.category, cl.data, cl.created_at
     FROM command_logs cl
     LEFT JOIN terminals t ON t.id = cl.terminal_id
     ${whereClause}
     ORDER BY cl.id DESC
     LIMIT $${paramIdx++}`,
    [...values, fetchLimit],
  )

  const hasMore = rows.length > input.limit
  const logs = hasMore ? rows.slice(0, input.limit) : rows
  const nextCursor = hasMore ? logs[logs.length - 1].id : undefined

  return { logs, nextCursor }
}

export async function getLogPrs() {
  const { rows } = await pool.query<{ pr_id: string }>(`
    SELECT pr_id
    FROM command_logs
    WHERE pr_id IS NOT NULL AND pr_id ~ '^.+/.+#\\d+$'
    GROUP BY pr_id
    ORDER BY MAX(created_at) DESC
    LIMIT 50
  `)
  return { prs: rows.map((r) => r.pr_id) }
}

export async function getLogTerminals() {
  const { rows } = await pool.query<LogTerminal>(`
    SELECT DISTINCT ON (cl.terminal_id)
      cl.terminal_id as id,
      COALESCE(t.name, cl.data->>'terminalName') as name,
      (t.id IS NULL) as deleted
    FROM command_logs cl
    LEFT JOIN terminals t ON t.id = cl.terminal_id
    WHERE cl.terminal_id IS NOT NULL
    ORDER BY cl.terminal_id, cl.created_at DESC
  `)

  return { terminals: rows }
}

export async function deleteLogs(input: InfiniteListInput) {
  const { values, whereClause } = buildLogFilters(input)

  const { rows } = await pool.query<{ id: number }>(
    `DELETE FROM command_logs ${whereClause} RETURNING id`,
    values,
  )
  return { deletedIds: rows.map((r) => r.id) }
}

async function cleanupOrphanedCommandLogs() {
  const result = await pool.query(`
    DELETE FROM command_logs
    WHERE terminal_id IS NOT NULL
      AND terminal_id NOT IN (SELECT id FROM terminals)
      AND created_at < NOW() - INTERVAL '1 week'
  `)
  if (result.rowCount && result.rowCount > 0) {
    log.info(`[db] Cleaned up ${result.rowCount} orphaned command_logs`)
  }
}

serverEvents.on('db:initialized', () => {
  cleanupOrphanedCommandLogs()
})
