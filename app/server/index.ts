import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import pino from 'pino'
import { Server as SocketIOServer } from 'socket.io'
import {
  deleteAllNotifications,
  getNotifications,
  initDb,
  markAllNotificationsRead,
  markNotificationRead,
} from './db'
import { env } from './env'
import {
  addPRComment,
  detectAllTerminalBranches,
  emitCachedPRChecks,
  fetchMergedPRsByMe,
  initGitHubChecks,
  mergePR,
  queueWebhookRefresh,
  refreshPRChecks,
  requestPRReview,
  rerunAllFailedChecks,
  rerunFailedCheck,
} from './github/checks'
import {
  createRepoWebhook,
  deleteRepoWebhook,
  getOrCreateWebhookSecret,
  initNgrok,
  recreateRepoWebhook,
  startWebhookValidationPolling,
  testWebhook,
  verifyWebhookSignature,
} from './github/webhooks'
import { setIO } from './io'
import { initPgListener } from './listen'
import { log, setLogger } from './logger'
import { startGitDirtyPolling } from './pty/manager'
import logsRoutes from './routes/logs'
import sessionRoutes from './routes/sessions'
import settingsRoutes from './routes/settings'
import terminalRoutes from './routes/terminals'
import { handleUpgrade } from './ws/terminal'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, use CLIENT_PORT since we serve both UI and API
const port = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT

// Write logs to file (and stdout in development)
const logsDir = path.join(__dirname, 'logs')
fs.mkdirSync(logsDir, { recursive: true })
const logFile = path.join(
  logsDir,
  `server-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
)
const logStreams: pino.StreamEntry[] = [{ stream: pino.destination(logFile) }]
if (env.NODE_ENV !== 'production') {
  logStreams.unshift({ stream: process.stdout })
}
const logStream = pino.multistream(logStreams)

const fastify = Fastify({
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
fastify.addHook('onRequest', async (request) => {
  request.log.info({ method: request.method, url: request.url }, 'request')
})

// Log errors
fastify.addHook('onError', async (request, _reply, error) => {
  request.log.error(
    { method: request.method, url: request.url, error: error.message },
    'error',
  )
})

// Initialize database
await initDb()

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
  startGitDirtyPolling()

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

// GitHub repos (for repo picker)
fastify.get<{
  Querystring: { q?: string }
}>('/api/github/repos', async (request) => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const query = request.query.q?.trim().toLowerCase() || ''

  try {
    const { stdout } = await exec(
      'gh',
      [
        'api',
        '--method',
        'GET',
        '/user/repos',
        '-f',
        'affiliation=owner,collaborator,organization_member',
        '-f',
        'sort=pushed',
        '-f',
        'direction=desc',
        '-f',
        `per_page=${query ? 100 : 15}`,
        '--jq',
        '.[].full_name',
      ],
      { timeout: 15000 },
    )

    let repos = stdout.trim().split('\n').filter(Boolean)
    if (query) {
      repos = repos.filter((r) => r.toLowerCase().includes(query))
    }
    return { repos }
  } catch {
    return { repos: [] }
  }
})

// Merged PRs by @me for a repo
fastify.get<{
  Params: { owner: string; repo: string }
  Querystring: { limit?: string; offset?: string }
}>('/api/github/:owner/:repo/merged-prs', async (request) => {
  const { owner, repo } = request.params
  const limit = Math.min(Number(request.query.limit) || 5, 50)
  const offset = Number(request.query.offset) || 0
  return fetchMergedPRsByMe(owner, repo, limit, offset)
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
  await refreshPRChecks(true, {
    repo: `${owner}/${repo}`,
    prNumber: Number(pr),
    until: (pr) =>
      pr?.reviews?.some(
        (r) => r.author === reviewer && r.state === 'PENDING',
      ) ?? false,
  })
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
  await refreshPRChecks(true, {
    repo: `${owner}/${repo}`,
    prNumber: Number(pr),
    until: (pr) => !pr || pr.state === 'MERGED',
  })
  return { ok: true }
})

// Add PR comment
fastify.post<{
  Params: { owner: string; repo: string; pr: string }
  Body: { body: string }
}>('/api/github/:owner/:repo/pr/:pr/comment', async (request, reply) => {
  const { owner, repo, pr } = request.params
  const { body } = request.body
  if (!body) {
    return reply.status(400).send({ error: 'body is required' })
  }
  const result = await addPRComment(owner, repo, Number(pr), body)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  await refreshPRChecks(true)
  return { ok: true }
})

// Re-run failed check
fastify.post<{
  Params: { owner: string; repo: string; pr: string }
  Body: { checkUrl: string }
}>('/api/github/:owner/:repo/pr/:pr/rerun-check', async (request, reply) => {
  const { owner, repo } = request.params
  const { checkUrl } = request.body
  if (!checkUrl) {
    return reply.status(400).send({ error: 'checkUrl is required' })
  }
  const result = await rerunFailedCheck(owner, repo, checkUrl)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  await refreshPRChecks(true, {
    repo: `${owner}/${repo}`,
    prNumber: Number(request.params.pr),
    // Poll until any check is queued/in_progress - the re-run creates a new
    // run ID so we can't match by the original detailsUrl
    until: (pr) => {
      if (!pr) return false
      return pr.checks.some(
        (c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS',
      )
    },
  })
  return { ok: true }
})

// Re-run all failed checks
fastify.post<{
  Params: { owner: string; repo: string; pr: string }
  Body: { checkUrls: string[] }
}>(
  '/api/github/:owner/:repo/pr/:pr/rerun-all-checks',
  async (request, reply) => {
    const { owner, repo } = request.params
    const { checkUrls } = request.body
    if (!checkUrls || !Array.isArray(checkUrls) || checkUrls.length === 0) {
      return reply.status(400).send({ error: 'checkUrls array is required' })
    }
    const result = await rerunAllFailedChecks(owner, repo, checkUrls)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    await refreshPRChecks(true, {
      repo: `${owner}/${repo}`,
      prNumber: Number(request.params.pr),
      until: (pr) => {
        if (!pr) return false
        // Consider done when at least one check is now queued/in_progress
        return pr.checks.some(
          (c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS',
        )
      },
    })
    return { ok: true, rerunCount: result.rerunCount }
  },
)

// GitHub Webhook endpoint
fastify.post<{
  Body: unknown
  Headers: { 'x-hub-signature-256'?: string; 'x-github-event'?: string }
}>('/api/webhooks/github', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256']
  const event = request.headers['x-github-event']

  if (!signature) {
    return reply.status(401).send({ error: 'Missing signature' })
  }

  const secret = await getOrCreateWebhookSecret()
  const payload =
    typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body)

  if (!verifyWebhookSignature(payload, signature, secret)) {
    return reply.status(401).send({ error: 'Invalid signature' })
  }

  // Extract repo from payload
  const body = request.body as { repository?: { full_name?: string } }
  const repo = body?.repository?.full_name

  // Handle ping event (webhook test)
  if (event === 'ping' && repo) {
    log.info(`[webhooks] Received ping for ${repo}`)
    io?.emit('webhook:ping', { repo })
    return { ok: true }
  }

  if (repo) {
    log.info(`[webhooks] Received ${event} event for ${repo}`)
    queueWebhookRefresh(repo)
  }

  return { ok: true }
})

// Webhook management routes
fastify.post<{
  Params: { owner: string; repo: string }
}>('/api/github/webhooks/:owner/:repo', async (request, reply) => {
  const { owner, repo } = request.params
  const result = await createRepoWebhook(`${owner}/${repo}`)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  return { ok: true, webhookId: result.webhookId }
})

fastify.delete<{
  Params: { owner: string; repo: string }
}>('/api/github/webhooks/:owner/:repo', async (request, reply) => {
  const { owner, repo } = request.params
  const result = await deleteRepoWebhook(`${owner}/${repo}`)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  return { ok: true }
})

fastify.post<{
  Params: { owner: string; repo: string }
}>('/api/github/webhooks/:owner/:repo/recreate', async (request, reply) => {
  const { owner, repo } = request.params
  const result = await recreateRepoWebhook(`${owner}/${repo}`)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  return { ok: true, webhookId: result.webhookId }
})

fastify.post<{
  Params: { owner: string; repo: string }
}>('/api/github/webhooks/:owner/:repo/test', async (request, reply) => {
  const { owner, repo } = request.params
  const result = await testWebhook(`${owner}/${repo}`)
  if (!result.ok) {
    return reply.status(500).send({ error: result.error })
  }
  return { ok: true }
})

// Notifications
fastify.get<{
  Querystring: { limit?: string; offset?: string }
}>('/api/notifications', async (request) => {
  const limit = Math.min(Number(request.query.limit) || 50, 100)
  const offset = Number(request.query.offset) || 0
  return getNotifications(limit, offset)
})

fastify.post('/api/notifications/mark-all-read', async () => {
  const count = await markAllNotificationsRead()
  return { count }
})

fastify.post<{ Params: { id: string } }>(
  '/api/notifications/:id/read',
  async (request) => {
    const id = Number(request.params.id)
    const success = await markNotificationRead(id)
    return { success }
  },
)

fastify.delete('/api/notifications', async () => {
  const count = await deleteAllNotifications()
  return { count }
})

// Routes
await fastify.register(terminalRoutes)
await fastify.register(settingsRoutes)
await fastify.register(sessionRoutes)
await fastify.register(logsRoutes)

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
  } catch {}
}

process.on('exit', stopDaemon)
process.on('SIGTERM', () => {
  stopDaemon()
  process.exit(0)
})
process.on('SIGINT', () => {
  stopDaemon()
  process.exit(0)
})

// Start server
const start = async () => {
  try {
    startDaemon()
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
      await initNgrok(port)
      startWebhookValidationPolling()
    } catch (err) {
      log.error({ err }, 'Failed to initialize ngrok')
    }
  } catch (err) {
    log.error({ err }, 'Server startup failed')
    process.exit(1)
  }
}

start()
