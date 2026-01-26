import type { FastifyInstance } from 'fastify'
import { deleteSession, getAllSessions } from '../db'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all Claude sessions with project paths
  fastify.get('/api/sessions', async () => {
    return getAllSessions()
  })

  // Delete a session and all related data
  fastify.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const deleted = deleteSession(id)
      if (!deleted) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return { ok: true }
    },
  )
}
