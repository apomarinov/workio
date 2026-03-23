import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  emitNotification,
  initWebPush,
  markDesktopActive,
} from '@domains/notifications/service'
import { startGitDirtyPolling } from '@domains/pty/monitor'
import { getActiveZellijSessionNames } from '@domains/pty/services/process-tree'
import {
  destroyAllSessions,
  getBellSubscribedShellIds,
  getSession,
  getSessionByTerminalId,
  setPendingCommand,
  subscribeBell,
  unsubscribeBell,
  writeShellIntegrationScripts,
  writeToSession,
} from '@domains/pty/session'
import { emitAllShellClients, handleUpgrade } from '@domains/pty/websocket'
import { getTerminalById } from '@domains/workspace/db/terminals'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { format } from 'date-fns'
import Fastify from 'fastify'
import pino from 'pino'
import { Server as SocketIOServer } from 'socket.io'
import { initDb } from './db'
import { env } from './env'
import {
  detectAllTerminalBranches,
  emitCachedPRChecks,
  initGitHubChecks,
  refreshPRChecks,
} from './github/checks'
import {
  initNgrok,
  startWebhookValidationPolling,
  stopNgrok,
} from './github/webhooks'
import { broadcastRefetch, type RefetchGroup, setIO } from './io'
import { initPgListener } from './listen'
import { log, setLogger } from './logger'
import claudeHookRoute from './routes/claude-hook'
import githubRoutes from './routes/github'
import terminalRoutes from './routes/terminals'
import { getServicesStatus, updateNgrokStatus } from './services/status'
import { shutdownAllTunnels } from './ssh/claude-forwarding'
import { closeAllConnections } from './ssh/pool'
import { createContext } from './trpc/init'
import { appRouter } from './trpc/router'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, use CLIENT_PORT since we serve both UI and API
const port = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT

// Write logs to file (and stdout in development)
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
if (env.NODE_ENV !== 'production') {
  logStreams.unshift({ stream: process.stdout })
}
const logStream = pino.multistream(logStreams)

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
  ),
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
if (env.BASIC_AUTH) {
  const [authUser, authPass] = env.BASIC_AUTH.split(':')
  const expected = `Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}`

  const ngrokDomain = env.NGROK_DOMAIN
  const AUTH_MAX_FAILURES = 5
  const AUTH_LOCKOUT_MS = 10 * 60 * 1000
  const ipFailures = new Map<
    string,
    { attempts: number; lockedUntil: number }
  >()

  fastify.addHook('onRequest', async (request, reply) => {
    // Only require auth when accessed through the ngrok domain
    const host = (request.headers.host || '').split(':')[0]
    if (host !== ngrokDomain) return

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
      if (entry.attempts >= AUTH_MAX_FAILURES) {
        entry.lockedUntil = Date.now() + AUTH_LOCKOUT_MS
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
  })

  log.info(`[auth] Basic auth enabled for user "${authUser}"`)
}

// Initialize database
await initDb()

// Write shell integration scripts to ~/.workio/shell-integration/
await writeShellIntegrationScripts()

// Initialize Web Push
await initWebPush()

// Setup Socket.IO
const io = new SocketIOServer(fastify.server, {
  cors: {
    origin:
      env.NODE_ENV === 'production'
        ? false
        : (origin, callback) => callback(null, origin || true),
    methods: ['GET', 'POST'],
  },
})
setIO(io)

io.on('connection', (socket) => {
  log.info(`Client connected: ${socket.id}`)
  emitAllShellClients(socket)
  emitCachedPRChecks(socket)
  refreshPRChecks()
  startGitDirtyPolling()
  socket.emit('services:status', getServicesStatus())

  // Bell subscriptions
  socket.emit('bell:subscriptions', getBellSubscribedShellIds())
  socket.on(
    'bell:subscribe',
    (data: {
      shellId: number
      terminalId: number
      command: string
      terminalName: string
    }) => {
      subscribeBell(data)
    },
  )
  socket.on('bell:unsubscribe', (data: { shellId: number }) => {
    unsubscribeBell(data.shellId)
  })

  socket.on('detect-branches', () => {
    detectAllTerminalBranches()
  })

  socket.on('zellij-attach', async (data: { terminalId: number }) => {
    const { terminalId } = data
    const session = getSessionByTerminalId(terminalId)
    if (!session) return
    const sessionName =
      session.sessionName ||
      (await getTerminalById(terminalId))?.name ||
      `terminal-${terminalId}`
    writeToSession(session.shell.id, `zellij attach '${sessionName}'\n`)
  })

  socket.on(
    'run-in-shell',
    async (data: { shellId: number; command: string; terminalId?: number }) => {
      const { shellId: targetShellId, command, terminalId } = data

      const ptySession = getSession(targetShellId)

      // If the PTY session doesn't exist yet (e.g. newly created shell),
      // queue the command to run after shell integration injection
      if (!ptySession) {
        setPendingCommand(targetShellId, command)
        return
      }

      const zellijName = terminalId
        ? ptySession.sessionName ||
          (await getTerminalById(terminalId))?.name ||
          `terminal-${terminalId}`
        : ptySession.sessionName
      const zellijSessions = await getActiveZellijSessionNames()
      const hasZellij = zellijName && zellijSessions.has(zellijName)

      if (hasZellij) {
        writeToSession(targetShellId, 'zellij action new-tab\n')
        setTimeout(() => {
          writeToSession(targetShellId, `${command}\n`)
        }, 300)
      } else {
        writeToSession(targetShellId, `${command}\n`)
      }
    },
  )

  socket.on(
    'kill-process',
    (data: { pid: number }, callback?: (result: { ok: boolean }) => void) => {
      const { pid } = data
      if (!pid || pid <= 0) {
        callback?.({ ok: false })
        return
      }
      try {
        process.kill(pid, 'SIGTERM')
        log.info(`[socket] Killed process ${pid}`)
        callback?.({ ok: true })
      } catch (err) {
        log.error({ err }, `[socket] Failed to kill process ${pid}`)
        callback?.({ ok: false })
      }
    },
  )

  socket.on('desktop:active', () => {
    markDesktopActive()
  })

  socket.on('disconnect', () => {
    log.info(`Client disconnected: ${socket.id}`)
  })
})

// Export io for use in other modules
export { io }

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
const REFETCH_ROUTES: [string, RefetchGroup][] = [
  ['/api/terminals', 'terminals'],
  ['/api/shells', 'terminals'],
  ['/api/settings', 'settings'],
  ['/api/notifications', 'notifications'],
]
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

fastify.addHook('onResponse', (request, reply, done) => {
  if (
    MUTATION_METHODS.has(request.method) &&
    reply.statusCode >= 200 &&
    reply.statusCode < 300
  ) {
    const excludeSocketId = request.headers['x-socket-id'] as string | undefined
    for (const [prefix, group] of REFETCH_ROUTES) {
      if (request.url.startsWith(prefix)) {
        broadcastRefetch(group, excludeSocketId)
        break
      }
    }
  }
  done()
})

// tRPC
await fastify.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: { router: appRouter, createContext },
})

// Routes
await fastify.register(githubRoutes)
await fastify.register(terminalRoutes)
await fastify.register(claudeHookRoute)

// Start monitor daemon (persistent Python process for hook events)
const projectRoot = path.resolve(__dirname, '../..')
const daemonScript = path.join(projectRoot, 'monitor_daemon.py')
let daemonProcess: ChildProcess | null = null

function startDaemon() {
  daemonProcess = spawn('python3', [daemonScript], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  daemonProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.info(`[daemon] ${msg}`)
  })
  daemonProcess.on('exit', (code) => {
    log.info(`[daemon] Monitor daemon exited with code ${code}`)
    daemonProcess = null
  })
}

function stopDaemon() {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM')
    daemonProcess = null
  }
  // Clean up socket file
  const sockPath = path.join(projectRoot, 'daemon.sock')
  try {
    fs.unlinkSync(sockPath)
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      log.error({ err }, '[daemon] Failed to clean up socket file')
    }
  }
}

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
    await initPgListener(io, env.DATABASE_URL)

    // Initialize GitHub PR checks polling
    initGitHubChecks()

    try {
      await initNgrok(env.CLIENT_PORT, !!httpsOptions)
      startWebhookValidationPolling()
    } catch (err) {
      log.error({ err }, 'Failed to initialize ngrok')
      updateNgrokStatus({ status: 'error', error: String(err) })
    }
  } catch (err) {
    log.error({ err }, 'Server startup failed')
    process.exit(1)
  }
}

start()
