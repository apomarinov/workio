import type { FastifyInstance } from 'fastify'
import {
  deleteSession,
  getAllSessions,
  getSessionMessages,
  updateSession,
} from '../db'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all Claude sessions with project paths
  fastify.get('/api/sessions', async () => {
    return getAllSessions()
  })

  // Update a session (rename)
  fastify.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const updated = updateSession(id, request.body)
      if (!updated) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return { ok: true }
    },
  )

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

  // Get paginated messages for a session
  fastify.get<{
    Params: { id: string }
    Querystring: { limit?: string; offset?: string }
  }>('/api/sessions/:id/messages', async (request) => {
    const { id } = request.params
    const limit = Math.min(Number(request.query.limit) || 30, 100)
    const offset = Number(request.query.offset) || 0
    return getSessionMessages(id, limit, offset)
  })
}
