import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'

// Expand ~ to home directory
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2))
  }
  if (p === '~') {
    return os.homedir()
  }
  return p
}

import {
  createTerminal,
  deleteTerminal,
  getAllTerminals,
  getTerminalById,
  updateTerminal,
} from '../db'
import { refreshPRChecks } from '../github/checks'
import { log } from '../logger'
import { destroySession } from '../pty/manager'
import { listSSHHosts, validateSSHHost } from '../ssh/config'

interface CreateTerminalBody {
  cwd?: string
  name?: string
  shell?: string
  ssh_host?: string
}

interface UpdateTerminalBody {
  name?: string
  cwd?: string
}

interface TerminalParams {
  id: string
}

export default async function terminalRoutes(fastify: FastifyInstance) {
  // List available SSH hosts from ~/.ssh/config
  fastify.get('/api/ssh/hosts', async () => {
    return listSSHHosts()
  })

  // List all terminals
  fastify.get('/api/terminals', async () => {
    const terminals = await getAllTerminals()
    return terminals.map((terminal) => ({
      ...terminal,
      orphaned: terminal.ssh_host ? false : !fs.existsSync(terminal.cwd),
    }))
  })

  // Create terminal
  fastify.post<{ Body: CreateTerminalBody }>(
    '/api/terminals',
    async (request, reply) => {
      const { cwd: rawCwd, name, shell, ssh_host } = request.body

      if (ssh_host) {
        // --- SSH terminal creation ---
        const trimmedHost = ssh_host.trim()
        if (!trimmedHost) {
          return reply.status(400).send({ error: 'ssh_host cannot be empty' })
        }

        const result = validateSSHHost(trimmedHost)
        if (!result.valid) {
          return reply.status(400).send({ error: result.error })
        }

        const terminal = await createTerminal(
          rawCwd?.trim() || '~',
          name?.trim() || trimmedHost,
          null,
          trimmedHost,
        )
        return reply.status(201).send(terminal)
      }

      // --- Local terminal creation ---
      if (!rawCwd) {
        return reply.status(400).send({ error: 'cwd is required' })
      }

      // Expand ~ to home directory
      const cwd = expandPath(rawCwd.trim())

      if (!fs.existsSync(cwd)) {
        return reply.status(400).send({ error: 'Directory does not exist' })
      }

      const stat = fs.statSync(cwd)
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: 'Path is not a directory' })
      }

      // Check read and execute permissions (needed to cd into and list directory)
      try {
        fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK)
      } catch {
        return reply
          .status(403)
          .send({ error: 'Permission denied: cannot access directory' })
      }

      const terminal = await createTerminal(cwd, name || null, shell || null)
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

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }
      return terminal
    },
  )

  // Update terminal
  fastify.patch<{ Params: TerminalParams; Body: UpdateTerminalBody }>(
    '/api/terminals/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10)
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid terminal id' })
      }

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      const body = { ...request.body }

      // Validate cwd if provided (skip for SSH terminals — path is remote)
      if (body.cwd !== undefined) {
        if (terminal.ssh_host) {
          body.cwd = body.cwd.trim()
        } else {
          const cwd = expandPath(body.cwd.trim())
          if (!fs.existsSync(cwd)) {
            return reply.status(400).send({ error: 'Directory does not exist' })
          }
          const stat = fs.statSync(cwd)
          if (!stat.isDirectory()) {
            return reply.status(400).send({ error: 'Path is not a directory' })
          }
          try {
            fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK)
          } catch {
            return reply
              .status(403)
              .send({ error: 'Permission denied: cannot access directory' })
          }
          body.cwd = cwd
        }
      }

      const updated = await updateTerminal(id, body)
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

      const terminal = await getTerminalById(id)
      if (!terminal) {
        return reply.status(404).send({ error: 'Terminal not found' })
      }

      // Kill PTY session if running
      const killed = destroySession(id)
      if (killed) {
        log.info(`[terminals] Killed PTY session for terminal ${id}`)
      }

      await deleteTerminal(id)
      refreshPRChecks()
      return reply.status(204).send()
    },
  )
}
