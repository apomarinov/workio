import { emitNotification } from '@domains/notifications/service'
import { getServerConfig } from '@domains/settings/server-config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from './env'
import { log } from './logger'
import { getNgrokUrl } from './ngrok'

/**
 * Creates the basic auth onRequest hook. Returns undefined if BASIC_AUTH is not set.
 * Closes over credentials and IP lockout state.
 */
export function createAuthHook():
  | ((request: FastifyRequest, reply: FastifyReply) => Promise<void>)
  | undefined {
  if (!env.BASIC_AUTH) return undefined

  const [authUser, authPass] = env.BASIC_AUTH.split(':')
  const expected = `Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}`

  const ipFailures = new Map<
    string,
    { attempts: number; lockedUntil: number }
  >()

  log.info(`[auth] Basic auth enabled for user "${authUser}"`)

  return async (request, reply) => {
    // Only require auth when accessed through the ngrok domain
    const host = (request.headers.host || '').split(':')[0]
    const ngrokUrl = getNgrokUrl()
    const ngrokDomain = ngrokUrl ? new URL(ngrokUrl).hostname : null
    if (!ngrokDomain || host !== ngrokDomain) return

    // Only require auth for API, WebSocket, and Socket.IO routes
    const url = request.url
    if (
      !url.startsWith('/api/') &&
      !url.startsWith('/ws/') &&
      !url.startsWith('/socket.io/')
    )
      return
    // GitHub webhooks must pass through without auth
    if (url.startsWith('/api/webhooks/github')) return

    const deny = () => {
      reply.code(401).header('WWW-Authenticate', 'Basic').send('Unauthorized')
    }

    // Valid credentials always pass
    if (request.headers.authorization === expected) return

    const ip =
      request.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      request.ip
    const entry = ipFailures.get(ip) ?? { attempts: 0, lockedUntil: 0 }

    // Lockout: deny this IP
    if (Date.now() < entry.lockedUntil) {
      deny()
      return
    }

    // Only count as brute-force if credentials were actually sent
    // (no header = browser's initial challenge, not a failed login)
    if (request.headers.authorization) {
      entry.attempts++
      if (entry.attempts >= getServerConfig('auth_max_failures')) {
        entry.lockedUntil = Date.now() + getServerConfig('auth_lockout_ms')
        log.warn(
          `[auth] IP ${ip} locked out after ${entry.attempts} failed attempts`,
        )
        emitNotification(
          'auth_lockout',
          undefined,
          { attempts: entry.attempts },
          `lockout:${ip}:${Date.now()}`,
        )
        entry.attempts = 0
      }
      ipFailures.set(ip, entry)
    }

    deny()
  }
}
