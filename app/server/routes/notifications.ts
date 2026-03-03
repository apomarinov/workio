import type { FastifyInstance } from 'fastify'
import { getShellById, getTerminalById } from '../db'
import { getIO } from '../io'
import { log } from '../logger'
import { sendPushNotification } from '../push'

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.post('/api/notifications/send', async (request, reply) => {
    const { title, body, terminalId, shellId } = request.body as {
      title?: string
      body?: string
      terminalId?: number
      shellId?: number
    }

    if (!title || !body) {
      return reply.status(400).send({ error: 'title and body are required' })
    }

    let terminalName: string | undefined
    let shellLabel: string | undefined

    if (terminalId) {
      const terminal = await getTerminalById(terminalId)
      if (terminal) terminalName = terminal.name || undefined
    }

    if (shellId) {
      const shell = await getShellById(shellId)
      if (shell) shellLabel = shell.active_cmd || shell.name || undefined
    }

    // Build body with terminal/shell context
    const contextParts: string[] = []
    if (terminalName) contextParts.push(terminalName)
    if (shellLabel) contextParts.push(shellLabel)
    const enrichedBody = contextParts.length
      ? `[${contextParts.join(' › ')}] ${body}`
      : body

    // Emit to web clients via a dedicated event (avoids DB-backed notification flow)
    getIO()?.emit('notification:custom', { title, body: enrichedBody })

    const tag = shellId
      ? `shell:${shellId}`
      : terminalId
        ? `terminal:${terminalId}`
        : 'custom-noti'

    sendPushNotification(
      { title: `📣 ${title}`, body: enrichedBody, tag },
      { force: true },
    ).catch((err) =>
      log.error({ err }, 'Failed to send custom push notification'),
    )

    return { ok: true }
  })
}
