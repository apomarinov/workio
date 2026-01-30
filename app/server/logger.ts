import type { FastifyBaseLogger } from 'fastify'

let _logger: FastifyBaseLogger | null = null

export function setLogger(l: FastifyBaseLogger) {
  _logger = l
}

/** Falls back to console before fastify is initialized. */
export const log = {
  info(msg: string) {
    _logger ? _logger.info(msg) : console.log(msg)
  },
  warn(msg: string) {
    _logger ? _logger.warn(msg) : console.warn(msg)
  },
  error(objOrMsg: unknown, msg?: string) {
    if (msg !== undefined) {
      _logger ? _logger.error(objOrMsg, msg) : console.error(msg, objOrMsg)
    } else {
      _logger ? _logger.error(objOrMsg as string) : console.error(objOrMsg)
    }
  },
}
