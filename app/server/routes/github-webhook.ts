import { webhookPayloadSchema } from '@domains/github/schema'
import { handleWebhookRequest } from '@domains/github/services/webhook-handler'
import {
  getOrCreateWebhookSecret,
  verifyWebhookSignature,
} from '@domains/github/services/webhooks'
import { logCommand } from '@domains/logs/db'
import type { FastifyInstance } from 'fastify'

export default async function githubWebhookRoute(fastify: FastifyInstance) {
  fastify.post<{
    Body: unknown
    Headers: { 'x-hub-signature-256'?: string; 'x-github-event'?: string }
  }>(
    '/api/webhooks/github',
    {
      config: {
        rateLimit: { max: 100, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const signature = request.headers['x-hub-signature-256']
      const event = request.headers['x-github-event'] || 'unknown'

      if (!signature) {
        logCommand({
          category: 'github',
          service: 'github-webhooks',
          command: `webhook ${event}`,
          stderr: 'Missing signature',
          failed: true,
        })
        return reply.status(401).send()
      }

      const secret = await getOrCreateWebhookSecret()
      const rawPayload =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body)

      if (!verifyWebhookSignature(rawPayload, signature, secret)) {
        logCommand({
          category: 'github',
          service: 'github-webhooks',
          command: `webhook ${event}`,
          stderr: 'Invalid signature',
          failed: true,
        })
        return reply.status(401).send()
      }

      const parsed = webhookPayloadSchema.safeParse(request.body)
      if (!parsed.success) {
        logCommand({
          category: 'github',
          service: 'github-webhooks',
          command: `webhook ${event}`,
          stderr: `Invalid payload: ${parsed.error.message}`,
          failed: true,
        })
        return reply.status(400).send()
      }

      const repo = parsed.data.repository?.full_name
      logCommand({
        prId: repo,
        category: 'github',
        service: 'github-webhooks',
        command: `webhook ${event}`,
        stdout: repo ? `${event} for ${repo}` : event,
      })

      handleWebhookRequest(event, parsed.data)

      reply.status(204).send()
    },
  )
}
