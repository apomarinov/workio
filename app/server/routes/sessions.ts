import type { FastifyInstance } from 'fastify'
import { getAllSessions } from '../db'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all Claude sessions with project paths
  fastify.get('/api/sessions', async () => {
    return getAllSessions()
  })
}
