import dotenv from 'dotenv'
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import path from 'path'
import { fileURLToPath } from 'url'
import sessionRoutes from './routes/sessions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '5176')

const fastify = Fastify({
  logger: true,
})

// Register plugins
await fastify.register(fastifyWebsocket)

// In production, serve built static files
if (process.env.NODE_ENV === 'production') {
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../dist'),
    prefix: '/',
  })
}

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok' }
})

// Session routes
await fastify.register(sessionRoutes)

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
    await fastify.listen({ port: SERVER_PORT, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
