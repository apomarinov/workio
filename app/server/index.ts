import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initGitStatus } from '@domains/git/services/status'
import { initGitHubChecks } from '@domains/github/services/checks/polling'
import { getGhUsername } from '@domains/github/services/checks/state'
import { startWebhookValidationPolling } from '@domains/github/services/webhooks'
import { initWebPush } from '@domains/notifications/service'
import {
  destroyAllSessions,
  getSessionsForTerminal,
  writeShellIntegrationScripts,
} from '@domains/pty/session'
import { handleUpgrade } from '@domains/pty/websocket'
import { initSessionListener } from '@domains/sessions/services/realtime-listener'
import { loadServerConfig } from '@domains/settings/server-config'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import pino from 'pino'
import { createAuthHook } from './auth'
import { startDaemon, stopDaemon } from './claude-hook-daemon'
import { initDb } from './db'
import { env } from './env'
import { onMutationResponse } from './io'
import { setupSocketIO } from './io-handlers'
import { createLogStream, log, setLogger } from './logger'
import { initNgrok, stopNgrok } from './ngrok'
import { appRouter } from './router'
import claudeHookRoute from './routes/claude-hook-ssh'
import githubWebhookRoute from './routes/github-webhook'
import { shutdownAllTunnels } from './ssh/claude-forwarding'
import { closeAllConnections } from './ssh/pool'
import { createContext } from './trpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, use CLIENT_PORT since we serve both UI and API
const port = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT

// Write logs to file (and stdout in development)
const logStream = createLogStream(env.NODE_ENV !== 'production')

// Try to load HTTPS certs
const certsDir = path.join(__dirname, '../../certs')
const certPath = path.join(certsDir, 'cert.pem')
const keyPath = path.join(certsDir, 'key.pem')
let httpsOptions: { key: Buffer; cert: Buffer } | undefined
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
}

const fastify = Fastify({
  ...(httpsOptions ? { https: httpsOptions } : {}),
  loggerInstance: pino(
    {
      level: 'info',
      base: undefined, // Remove pid, hostname
      formatters: {
        level: (label) => ({ level: label }),
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    logStream,
  ) as FastifyBaseLogger,
  disableRequestLogging: true, // Disable default verbose request logging
})
setLogger(fastify.log)

// Simple request logging
fastify.addHook('preHandler', async (request) => {
  request.log.info(
    { method: request.method, url: request.url, body: request.body },
    'request',
  )
})

// Log errors (uncaught exceptions)
fastify.addHook('onError', async (request, _reply, error) => {
  request.log.error(
    { method: request.method, url: request.url, error: error.message },
    'error',
  )
})

// Log non-2xx responses
fastify.addHook('onResponse', async (request, reply) => {
  if (reply.statusCode >= 400) {
    request.log.error(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
      },
      'error response',
    )
  }
})

// Rate limiting (off by default, applied per-route)
await fastify.register(rateLimit, { global: false })

// Basic auth protection (when BASIC_AUTH env is set)
const authHook = createAuthHook()
if (authHook) fastify.addHook('onRequest', authHook)

// Initialize database
await initDb()

// Load server config into memory
await loadServerConfig()

// Write shell integration scripts to ~/.workio/shell-integration/
await writeShellIntegrationScripts()

// Initialize Web Push
await initWebPush()

// Initialize git status tracking (inject pty session check to avoid circular imports)
initGitStatus({
  hasActiveSessions: (terminalId) =>
    getSessionsForTerminal(terminalId).length > 0,
  getFallbackUsername: () => getGhUsername(),
})

// Setup Socket.IO
setupSocketIO(fastify.server)

// In production, serve built static files
if (env.NODE_ENV === 'production') {
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../dist'),
    prefix: '/',
  })
}

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok' }
})

// Broadcast refetch events to all clients after successful mutations
fastify.addHook('onResponse', onMutationResponse)

// tRPC
await fastify.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: { router: appRouter, createContext },
})

// Routes
await fastify.register(githubWebhookRoute)
await fastify.register(claudeHookRoute)

// Shutdown handling
process.on('exit', stopDaemon)
function shutdown() {
  destroyAllSessions()
  closeAllConnections()
  shutdownAllTunnels()
  stopNgrok()
  stopDaemon()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Start server
const start = async () => {
  try {
    startDaemon()
    if (httpsOptions) {
      log.info(`[server] HTTPS enabled (certs from ${certsDir})`)
    } else {
      log.info(
        '[server] No certs found, running HTTP. Run `npm run certs` to enable HTTPS.',
      )
    }
    await fastify.listen({ port, host: '0.0.0.0' })

    // Handle WebSocket upgrades for terminal PTY
    // Use prependListener to run before Socket.IO's handler
    fastify.server.prependListener('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`)
      if (url.pathname === '/ws/terminal') {
        handleUpgrade(request, socket, head)
      }
      // For other paths (like /socket.io/), let Socket.IO handle it
    })

    log.info('[ws] Terminal WebSocket handler registered at /ws/terminal')

    // Initialize PostgreSQL NOTIFY/LISTEN
    await initSessionListener(env.DATABASE_URL)

    // Initialize GitHub PR checks polling
    initGitHubChecks()

    const ngrokStarted = await initNgrok(env.CLIENT_PORT, !!httpsOptions)
    if (ngrokStarted) startWebhookValidationPolling()
  } catch (err) {
    log.error({ err }, 'Server startup failed')
    process.exit(1)
  }
}

start()
