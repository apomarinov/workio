/**
 * POST /claude-hook — HTTP ingest route for remote Claude hook events.
 *
 * Receives enriched payloads from the remote forwarder via SSH reverse tunnel.
 * Mirrors transcript deltas locally, then forwards to monitor_daemon.py
 * via Unix socket (same JSON+newline protocol as monitor.py).
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { log } from '../logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')
const DAEMON_SOCK = path.join(PROJECT_ROOT, 'daemon.sock')
const MIRRORS_DIR = path.join(os.homedir(), '.workio', 'mirrors')

interface ClaudeHookBody {
  event: Record<string, unknown>
  env?: Record<string, string>
  host_alias: string
  transcript_delta?: string
  transcript_offset?: number
  session_index?: Record<string, unknown>
}

/**
 * Forward a message to the monitor daemon via Unix socket.
 * Same protocol as monitor.py: JSON line in, JSON line out.
 */
function forwardToDaemon(message: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(DAEMON_SOCK)
    sock.setTimeout(5000)

    const payload = `${JSON.stringify(message)}\n`
    let response = ''

    sock.on('connect', () => {
      sock.write(payload)
    })

    sock.on('data', (data) => {
      response += data.toString()
      if (response.includes('\n')) {
        sock.end()
      }
    })

    sock.on('end', () => {
      resolve(response.trim())
    })

    sock.on('error', (err) => {
      reject(err)
    })

    sock.on('timeout', () => {
      sock.destroy()
      reject(new Error('Daemon socket timeout'))
    })
  })
}

export default async function claudeHookRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: ClaudeHookBody }>(
    '/claude-hook',
    {
      config: {
        rateLimit: { max: 200, timeWindow: '1 minute' },
      },
      bodyLimit: 10 * 1024 * 1024, // 10MB
    },
    async (request, reply) => {
      const { event, env, host_alias, transcript_delta, session_index } =
        request.body

      if (!event || !host_alias) {
        return reply
          .status(400)
          .send({ error: 'event and host_alias are required' })
      }

      const sessionId =
        (event.session_id as string) || (event.sessionId as string) || ''

      // Rewrite transcript_path to local mirror path (even without delta,
      // so the daemon stores the correct local path for worker.py)
      if (sessionId) {
        const mirrorDir = path.join(MIRRORS_DIR, host_alias)
        const mirrorPath = path.join(mirrorDir, `${sessionId}.jsonl`)
        event.transcript_path = mirrorPath

        // Append transcript delta if present
        if (transcript_delta) {
          try {
            await fs.promises.mkdir(mirrorDir, { recursive: true })
            await fs.promises.appendFile(mirrorPath, transcript_delta)
          } catch (err) {
            log.error(
              { err, sessionId, host_alias },
              '[claude-hook] Failed to mirror transcript',
            )
          }
        }
      }

      // Forward to daemon via Unix socket
      try {
        const daemonMessage = {
          event,
          env: env || {},
          host: host_alias,
          session_index: session_index || null,
        }
        await forwardToDaemon(daemonMessage)
      } catch (err) {
        log.error(
          { err, sessionId, host_alias },
          '[claude-hook] Failed to forward to daemon',
        )
        return reply.status(502).send({ error: 'Failed to process hook' })
      }

      return { ok: true }
    },
  )
}
