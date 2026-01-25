import { env } from './env'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server as SocketIOServer } from 'socket.io'
import terminalRoutes from './routes/terminals'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, use CLIENT_PORT since we serve both UI and API
const port = env.NODE_ENV === 'production' ? env.CLIENT_PORT : env.SERVER_PORT

const fastify = Fastify({
  logger: true,
})

// Setup Socket.IO
const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: env.NODE_ENV === 'production' ? false : `http://localhost:${env.CLIENT_PORT}`,
    methods: ['GET', 'POST'],
  },
})

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

// Terminal routes
await fastify.register(terminalRoutes)

// Start server
const start = async () => {
  try {
    await fastify.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
