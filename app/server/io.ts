import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Socket, Server as SocketIOServer } from 'socket.io'
import { log } from './logger'

let io: SocketIOServer | null = null

export function parseUserAgent(ua: string): {
  device: string
  browser: string
} {
  let device = 'Unknown'
  if (/iPhone/i.test(ua)) device = 'iPhone'
  else if (/iPad/i.test(ua)) device = 'iPad'
  else if (/Android/i.test(ua)) device = 'Android'
  else if (/Macintosh/i.test(ua)) device = 'Mac'
  else if (/Windows/i.test(ua)) device = 'Windows'
  else if (/Linux/i.test(ua)) device = 'Linux'
  let browser = 'Unknown'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua)) browser = 'Safari'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  return { device, browser }
}

function socketLabel(s: Socket): string {
  const h = s.handshake
  const { device, browser } = parseUserAgent(h.headers['user-agent'] ?? '')
  let ip = h.address
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1'
  return `${device}/${browser}@${ip}`
}

export function setIO(server: SocketIOServer): void {
  io = server
}

export function getIO(): SocketIOServer | null {
  return io
}

export type RefetchGroup =
  | 'terminals'
  | 'sessions'
  | 'settings'
  | 'notifications'

export function broadcastRefetch(
  group: RefetchGroup,
  excludeSocketId?: string,
) {
  const server = getIO()
  if (!server) return
  const allSockets = [...server.sockets.sockets.values()]
  const sender = excludeSocketId
    ? allSockets.find((s) => s.id === excludeSocketId)
    : undefined
  const recipients = excludeSocketId
    ? allSockets.filter((s) => s.id !== excludeSocketId)
    : allSockets
  if (recipients.length === 0) return
  log.info(
    {
      group,
      from: sender ? socketLabel(sender) : 'server',
      to: recipients.map(socketLabel),
    },
    '[refetch]',
  )
  if (excludeSocketId) {
    server.except(excludeSocketId).emit('refetch', { group })
  } else {
    server.emit('refetch', { group })
  }
}

/**
 * onResponse hook that broadcasts refetch events
 * to Socket.IO clients after successful tRPC mutations.
 */
const REFETCH_ROUTES: [string, RefetchGroup][] = [
  ['/api/trpc/workspace.', 'terminals'],
  ['/api/trpc/settings.', 'settings'],
  ['/api/trpc/notifications.', 'notifications'],
  ['/api/trpc/sessions.', 'sessions'],
]

export function onMutationResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) {
  if (
    request.method === 'POST' &&
    reply.statusCode >= 200 &&
    reply.statusCode < 300
  ) {
    const excludeSocketId = request.headers['x-socket-id'] as string | undefined
    for (const [prefix, group] of REFETCH_ROUTES) {
      if (request.url.startsWith(prefix)) {
        broadcastRefetch(group, excludeSocketId)
        break
      }
    }
  }
  done()
}
