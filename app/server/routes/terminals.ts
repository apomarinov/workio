import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import {
  createTerminal,
  deleteTerminal,
  getAllTerminals,
  getTerminalById,
  updateTerminal,
} from '../db'
import { destroySession } from '../pty/manager'

interface CreateTerminalBody {
  cwd: string
  name?: string
  shell?: string
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
    const terminals = getAllTerminals()
    return terminals.map((terminal) => ({
      ...terminal,
      orphaned: !fs.existsSync(terminal.cwd),
    }))
  })

  // Create terminal
  fastify.post<{ Body: CreateTerminalBody }>(
    '/api/terminals',
    async (request, reply) => {
      const { cwd, name, shell } = request.body

      if (!cwd) {
        return reply.status(400).send({ error: 'cwd is required' })
      }

      if (!fs.existsSync(cwd)) {
        return reply.status(400).send({ error: 'Directory does not exist' })
      }

      const stat = fs.statSync(cwd)
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: 'Path is not a directory' })
      }

      const terminal = createTerminal(cwd, name || null, shell || null)
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

      // Kill PTY session if running
      const killed = destroySession(id)
      if (killed) {
        fastify.log.info(`[terminals] Killed PTY session for terminal ${id}`)
      }

      deleteTerminal(id)
      return reply.status(204).send()
    },
  )
}
