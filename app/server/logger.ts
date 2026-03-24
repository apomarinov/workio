import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'date-fns'
import type { FastifyBaseLogger } from 'fastify'
import pino from 'pino'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let _logger: FastifyBaseLogger | null = null

export function setLogger(l: FastifyBaseLogger) {
  _logger = l
}

/** Falls back to console before fastify is initialized. */
export const log = {
  info(objOrMsg: unknown, msg?: string) {
    if (msg !== undefined) {
      _logger ? _logger.info(objOrMsg, msg) : console.log(msg, objOrMsg)
    } else {
      _logger ? _logger.info(objOrMsg as string) : console.log(objOrMsg)
    }
  },
  warn(objOrMsg: unknown, msg?: string) {
    if (msg !== undefined) {
      _logger ? _logger.warn(objOrMsg, msg) : console.warn(msg, objOrMsg)
    } else {
      _logger ? _logger.warn(objOrMsg as string) : console.warn(objOrMsg)
    }
  },
  error(objOrMsg: unknown, msg?: string) {
    if (msg !== undefined) {
      _logger ? _logger.error(objOrMsg, msg) : console.error(msg, objOrMsg)
    } else {
      _logger ? _logger.error(objOrMsg as string) : console.error(objOrMsg)
    }
  },
}

/**
 * Creates a pino multistream that writes to a timestamped log file
 * (and stdout in development). Rotates to keep only the last 10 logs.
 */
export function createLogStream(isDev: boolean): pino.MultiStreamRes {
  const logsDir = path.join(__dirname, 'logs')
  fs.mkdirSync(logsDir, { recursive: true })

  // Keep only the last 10 server logs
  const existingLogs = fs
    .readdirSync(logsDir)
    .filter((f) => f.startsWith('server-') && f.endsWith('.jsonl'))
    .sort()
    .reverse()
  for (const oldLog of existingLogs.slice(10)) {
    fs.unlinkSync(path.join(logsDir, oldLog))
  }

  const logFile = path.join(
    logsDir,
    `server-${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.jsonl`,
  )
  const logStreams: pino.StreamEntry[] = [{ stream: pino.destination(logFile) }]
  if (isDev) {
    logStreams.unshift({ stream: process.stdout })
  }
  return pino.multistream(logStreams)
}
