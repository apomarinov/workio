import { FastifyInstance } from 'fastify'
import {
  getProjectByPath,
  getSessionByProjectId,
  getAllSessions,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
} from '../db.js'

interface CreateSessionBody {
  cwd: string
  name?: string
}

interface UpdateSessionBody {
  name?: string
}

interface SessionParams {
  id: string
}

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all sessions
  fastify.get('/api/sessions', async () => {
    return getAllSessions()
  })

  // Create session (or return existing if project already has one)
  fastify.post<{ Body: CreateSessionBody }>('/api/sessions', async (request, reply) => {
    const { cwd, name } = request.body

    if (!cwd) {
      return reply.status(400).send({ error: 'cwd is required' })
    }

    // Find project by cwd
    const project = getProjectByPath(cwd)
    if (!project) {
      return reply.status(404).send({ error: 'Project not found for this path' })
    }

    // Check if session already exists for this project
    const existing = getSessionByProjectId(project.id)
    if (existing) {
      return existing
    }

    // Create new session
    const session = createSession(project.id, name || null)
    return reply.status(201).send(session)
  })

  // Get single session
  fastify.get<{ Params: SessionParams }>('/api/sessions/:id', async (request, reply) => {
    const id = parseInt(request.params.id)
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid session id' })
    }

    const session = getSessionById(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    return session
  })

  // Update session (rename)
  fastify.patch<{ Params: SessionParams; Body: UpdateSessionBody }>('/api/sessions/:id', async (request, reply) => {
    const id = parseInt(request.params.id)
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid session id' })
    }

    const session = getSessionById(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    const updated = updateSession(id, request.body)
    return updated
  })

  // Delete session
  fastify.delete<{ Params: SessionParams }>('/api/sessions/:id', async (request, reply) => {
    const id = parseInt(request.params.id)
    if (isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid session id' })
    }

    const session = getSessionById(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }

    // TODO: Kill PTY process if running (Phase 3)

    deleteSession(id)
    return reply.status(204).send()
  })
}
