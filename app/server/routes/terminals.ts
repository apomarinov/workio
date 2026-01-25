import type { FastifyInstance } from 'fastify'
import {
  createTerminal,
  deleteTerminal,
  getAllTerminals,
  getTerminalById,
  updateTerminal,
} from '../db'

interface CreateTerminalBody {
  cwd: string
  name?: string
}

interface UpdateTerminalBody {
  name?: string
}

interface TerminalParams {
  id: string
}

export default async function terminalRoutes(fastify: FastifyInstance) {
  // List all terminals
  fastify.get('/api/terminals', async () => {
    return getAllTerminals()
  })

  // Create terminal
  fastify.post<{ Body: CreateTerminalBody }>(
    '/api/terminals',
    async (request, reply) => {
      const { cwd, name } = request.body

      if (!cwd) {
        return reply.status(400).send({ error: 'cwd is required' })
      }

      const terminal = createTerminal(cwd, name || null)
      return reply.status(201).send(terminal)
    },
  )

  // Get single terminal
  fastify.get<{ Params: TerminalParams }>(
    '/api/terminals/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }
      return terminal
    },
  )

  // Update terminal (rename)
  fastify.patch<{ Params: TerminalParams; Body: UpdateTerminalBody }>(
    '/api/terminals/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      const updated = updateTerminal(id, request.body)
      return updated
    },
  )

  // Delete terminal
  fastify.delete<{ Params: TerminalParams }>(
    '/api/terminals/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      // TODO: Kill PTY process if running (Phase 3)

      deleteTerminal(id)
      return reply.status(204).send()
    },
  )
}
