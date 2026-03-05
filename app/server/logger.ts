import type { FastifyBaseLogger } from 'fastify'

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
