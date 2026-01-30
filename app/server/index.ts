import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import pino from 'pino'
import { Server as SocketIOServer } from 'socket.io'
import { env } from './env'
import {
  detectAllTerminalBranches,
  emitCachedPRChecks,
  fetchPRComments,
  initGitHubChecks,
  mergePR,
  refreshPRChecks,
  requestPRReview,
} from './github/checks'
import { setIO } from './io'
import { log, setLogger } from './logger'
import sessionRoutes from './routes/sessions'
import settingsRoutes from './routes/settings'
import terminalRoutes from './routes/terminals'
import { handleUpgrade } from './ws/terminal'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, use CLIENT_PORT since we serve both UI and API
const port = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT

// Write logs to both stdout and a per-run JSONL file
const logsDir = path.join(__dirname, 'logs')
fs.mkdirSync(logsDir, { recursive: true })
const logFile = path.join(
  logsDir,
  `server-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
)
const logStream = pino.multistream([
  { stream: process.stdout },
  { stream: pino.destination(logFile) },
])

const fastify = Fastify({
  loggerInstance: pino({ level: 'info' }, logStream),
})
setLogger(fastify.log)

// Setup Socket.IO
const io = new SocketIOServer(fastify.server, {
  cors: {
    origin:
      env.NODE_ENV === 'production'
        ? false
        : `http://localhost:${env.CLIENT_PORT}`,
    methods: ['GET', 'POST'],
  },
})
setIO(io)

io.on('connection', (socket) => {
  log.info(`Client connected: ${socket.id}`)
  emitCachedPRChecks(socket)
  refreshPRChecks()

  socket.on('detect-branches', () => {
    detectAllTerminalBranches()
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

// Emit to Socket.IO clients
fastify.post('/api/emit', async (request, reply) => {
  const { event, data } = request.body as { event: string; data: unknown }
  if (!event) {
    return reply.status(400).send({ error: 'event is required' })
  }
  io.emit(event, data)
  return { ok: true }
})

// GitHub PR comments
fastify.get<{
  Params: { owner: string; repo: string; pr: string }
  Querystring: { limit?: string; offset?: string; exclude?: string }
}>('/api/github/:owner/:repo/pr/:pr/comments', async (request) => {
  const { owner, repo, pr } = request.params
  const limit = Math.min(Number(request.query.limit) || 20, 100)
  const offset = Number(request.query.offset) || 0
  const excludeAuthors = request.query.exclude
    ? request.query.exclude.split(',').filter(Boolean)
    : undefined
  return fetchPRComments(owner, repo, Number(pr), limit, offset, excludeAuthors)
})

// Re-request PR review
fastify.post<{
  Params: { owner: string; repo: string; pr: string }
  Body: { reviewer: string }
}>('/api/github/:owner/:repo/pr/:pr/request-review', async (request, reply) => {
  const { owner, repo, pr } = request.params
  const { reviewer } = request.body
  if (!reviewer) {
    return reply.status(400).send({ error: 'reviewer is required' })
  }
  const result = await requestPRReview(owner, repo, Number(pr), reviewer)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  refreshPRChecks()
  return { ok: true }
})

// Merge PR
fastify.post<{
  Params: { owner: string; repo: string; pr: string }
  Body: { method?: 'merge' | 'squash' | 'rebase' }
}>('/api/github/:owner/:repo/pr/:pr/merge', async (request, reply) => {
  const { owner, repo, pr } = request.params
  const method = request.body?.method || 'squash'
  const result = await mergePR(owner, repo, Number(pr), method)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  refreshPRChecks()
  return { ok: true }
})

// Routes
await fastify.register(terminalRoutes)
await fastify.register(settingsRoutes)
await fastify.register(sessionRoutes)

// Start server
const start = async () => {
  try {
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

    // Initialize GitHub PR checks polling
    initGitHubChecks()
  } catch (err) {
    log.error({ err }, 'Server startup failed')
    process.exit(1)
  }
}

start()
