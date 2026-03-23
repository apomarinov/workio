import { handleClaudeHook } from '@domains/sessions/services/hook'
import type { FastifyInstance } from 'fastify'
import { log } from '../logger'

interface ClaudeHookBody {
  event: Record<string, unknown>
  env?: Record<string, string>
  host_alias: string
  transcript_delta?: string
  transcript_offset?: number
  session_index?: Record<string, unknown>
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

      try {
        await handleClaudeHook(
          event,
          env,
          host_alias,
          transcript_delta,
          session_index,
        )
      } catch (err) {
        const sessionId =
          (event.session_id as string) || (event.sessionId as string) || ''
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
