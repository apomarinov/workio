import { getTerminalById } from '@domains/workspace/db/terminals'
import pool from '@server/db'
import { log } from '@server/logger'
import type { CommandLog, ListInput, LogTerminal } from './schema'

interface LogCommandOptions {
  terminalId?: number
  prId?: string // "owner/repo#123" format
  category: 'git' | 'workspace' | 'github'
  command: string
  stdout?: string
  stderr?: string
  failed?: boolean
}

/** Fire-and-forget command logging - callers do not await */
export async function logCommand(opts: LogCommandOptions) {
  try {
    const exitCode = opts.failed ? 1 : 0
    let sshHost: string | undefined
    let terminalName: string | undefined
    if (opts.terminalId) {
      const terminal = await getTerminalById(opts.terminalId)
      if (terminal) {
        sshHost = terminal.ssh_host ?? undefined
        terminalName = terminal.name ?? undefined
      }
    }
    // If not failed, combine stderr into stdout (git often outputs progress to stderr)
    let stdout = opts.stdout ?? ''
    let stderr: string | undefined
    if (opts.failed) {
      stderr = opts.stderr
    } else if (opts.stderr) {
      stdout = stdout ? `${stdout}\n${opts.stderr}` : opts.stderr
    }

    await pool.query(
      `INSERT INTO command_logs (terminal_id, pr_id, exit_code, category, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        opts.terminalId ?? null,
        opts.prId ?? null,
        exitCode,
        opts.category,
        JSON.stringify({
          command: opts.command,
          stdout: stdout.substring(0, 10000) || undefined,
          stderr: stderr?.substring(0, 5000),
          sshHost,
          terminalName,
        }),
      ],
    )
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

export async function getLogTerminals() {
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
}

export async function cleanupOrphanedCommandLogs() {
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
