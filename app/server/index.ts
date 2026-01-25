import { env } from './env'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import path from 'path'
import { fileURLToPath } from 'url'
import terminalRoutes from './routes/terminals'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const fastify = Fastify({
  logger: true,
})

// Register plugins
await fastify.register(fastifyWebsocket)

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

// Terminal routes
await fastify.register(terminalRoutes)

// Placeholder for WebSocket (Phase 4)
fastify.get('/ws', { websocket: true }, (socket) => {
  socket.on('message', (message) => {
    fastify.log.info(`Received: ${message}`)
  })
  socket.send(JSON.stringify({ type: 'connected' }))
})

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
