import type { FastifyInstance } from 'fastify'
import {
  deleteSession,
  deleteSessions,
  getAllSessions,
  getOldSessionIds,
  getSessionById,
  getSessionMessages,
  getSettings,
  searchSessionMessages,
  updateSession,
  updateSettings,
} from '../db'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all Claude sessions with project paths
  fastify.get('/api/sessions', async () => {
    const [sessions, settings] = await Promise.all([
      getAllSessions(),
      getSettings(),
    ])
    const favorites = settings.favorite_sessions ?? []
    const favoriteSet = new Set(favorites)

    // Cleanup stale favorites
    const sessionIds = new Set(sessions.map((s) => s.session_id))
    const cleaned = favorites.filter((id) => sessionIds.has(id))
    if (cleaned.length !== favorites.length) {
      updateSettings({ favorite_sessions: cleaned })
    }

    return sessions.map((s) => ({
      ...s,
      is_favorite: favoriteSet.has(s.session_id),
    }))
  })

  // Toggle favorite status for a session
  fastify.post<{ Params: { id: string } }>(
    '/api/sessions/:id/favorite',
    async (request) => {
      const { id } = request.params
      const settings = await getSettings()
      const favorites = settings.favorite_sessions ?? []
      const index = favorites.indexOf(id)
      const isFavorite = index === -1
      const updated = isFavorite
        ? [...favorites, id]
        : favorites.filter((fid) => fid !== id)
      await updateSettings({ favorite_sessions: updated })
      return { is_favorite: isFavorite }
    },
  )

  // Cleanup old sessions
  fastify.post<{ Body: { weeks: number } }>(
    '/api/sessions/cleanup',
    async (request, reply) => {
      const { weeks } = request.body
      if (!weeks || weeks < 1) {
        return reply.status(400).send({ error: 'weeks must be at least 1' })
      }
      const settings = await getSettings()
      const favoriteIds = settings.favorite_sessions ?? []
      const oldIds = await getOldSessionIds(weeks, favoriteIds)
      if (oldIds.length === 0) {
        return { deleted: 0 }
      }
      const deleted = await deleteSessions(oldIds)
      return { deleted }
    },
  )

  // Search session messages
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/sessions/search',
    async (request, reply) => {
      const q = request.query.q?.trim()
      if (!q || q.length < 2) {
        return reply
          .status(400)
          .send({ error: 'Query must be at least 2 characters' })
      }
      return await searchSessionMessages(q)
    },
  )

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
