import type { FastifyInstance } from 'fastify'
import {
  deleteSession,
  deleteSessions,
  getAllSessions,
  getSessionById,
  getSessionMessages,
  updateSession,
} from '../db'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all Claude sessions with project paths
  fastify.get('/api/sessions', async () => {
    return await getAllSessions()
  })

  // Get a single session by ID
  fastify.get<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const session = await getSessionById(id)
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return session
    },
  )

  // Update a session (rename)
  fastify.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const updated = await updateSession(id, request.body)
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
      const deleted = await deleteSession(id)
      if (!deleted) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return { ok: true }
    },
  )

  // Bulk delete sessions
  fastify.delete<{ Body: { ids: string[] } }>(
    '/api/sessions',
    async (request, reply) => {
      const { ids } = request.body
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids array is required' })
      }
      const deleted = await deleteSessions(ids)
      return { ok: true, deleted }
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
    return await getSessionMessages(id, limit, offset)
  })
}
