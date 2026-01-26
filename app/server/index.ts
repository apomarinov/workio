import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { Server as SocketIOServer } from 'socket.io'
import { env } from './env'
import { setIO } from './io'
import sessionRoutes from './routes/sessions'
import settingsRoutes from './routes/settings'
import terminalRoutes from './routes/terminals'
import { handleUpgrade } from './ws/terminal'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, use CLIENT_PORT since we serve both UI and API
const port = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT

const fastify = Fastify({
  logger: true,
})

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
  fastify.log.info(`Client connected: ${socket.id}`)

  socket.on('disconnect', () => {
    fastify.log.info(`Client disconnected: ${socket.id}`)
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

    fastify.log.info(
      '[ws] Terminal WebSocket handler registered at /ws/terminal',
    )
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
