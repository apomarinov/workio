import type { FastifyInstance } from 'fastify'
import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  getShellById,
  getTerminalById,
  getUnreadPRNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationReadByItem,
  markNotificationUnread,
  markPRNotificationsRead,
} from '../db'
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

  // Notification CRUD
  fastify.get<{
    Querystring: { limit?: string; offset?: string }
  }>('/api/notifications', async (request) => {
    const limit = Math.min(Number(request.query.limit) || 50, 100)
    const offset = Number(request.query.offset) || 0
    return getNotifications(limit, offset)
  })

  fastify.get('/api/notifications/pr-unread', async () => {
    return getUnreadPRNotifications()
  })

  fastify.post('/api/notifications/mark-all-read', async () => {
    const count = await markAllNotificationsRead()
    return { count }
  })

  fastify.post<{ Body: { repo: string; prNumber: number } }>(
    '/api/notifications/pr-read',
    async (request) => {
      const { repo, prNumber } = request.body
      const count = await markPRNotificationsRead(repo, prNumber)
      return { count }
    },
  )

  fastify.post<{
    Body: {
      repo: string
      prNumber: number
      commentId?: number
      reviewId?: number
    }
  }>('/api/notifications/item-read', async (request) => {
    const { repo, prNumber, commentId, reviewId } = request.body
    const success = await markNotificationReadByItem(
      repo,
      prNumber,
      commentId,
      reviewId,
    )
    return { success }
  })

  fastify.post<{ Params: { id: string } }>(
    '/api/notifications/:id/read',
    async (request) => {
      const id = Number(request.params.id)
      const success = await markNotificationRead(id)
      return { success }
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/notifications/:id/unread',
    async (request) => {
      const id = Number(request.params.id)
      const success = await markNotificationUnread(id)
      return { success }
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/api/notifications/:id',
    async (request) => {
      const id = Number(request.params.id)
      const success = await deleteNotification(id)
      return { success }
    },
  )

  fastify.delete('/api/notifications', async () => {
    const count = await deleteAllNotifications()
    return { count }
  })
}
