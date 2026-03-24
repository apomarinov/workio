import type { Server as HttpServer } from 'node:http'
import {
  detectAllTerminalBranches,
  emitCachedPRChecks,
  refreshPRChecks,
} from '@domains/github/services/checks/polling'
import { markDesktopActive } from '@domains/notifications/service'
import { startGitDirtyPolling } from '@domains/pty/monitor'
import { getActiveZellijSessionNames } from '@domains/pty/services/process-tree'
import {
  getBellSubscribedShellIds,
  getSession,
  getSessionByTerminalId,
  setPendingCommand,
  subscribeBell,
  unsubscribeBell,
  writeToSession,
} from '@domains/pty/session'
import { emitAllShellClients } from '@domains/pty/websocket'
import { getTerminalById } from '@domains/workspace/db/terminals'

import type { FastifyReply, FastifyRequest } from 'fastify'
import { type Socket, Server as SocketIOServer } from 'socket.io'
import { env } from './env'
import { log } from './logger'
import { getServicesStatus } from './services/status'

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
 * Creates the Socket.IO server and registers all connection event handlers.
 */
export function setupSocketIO(httpServer: HttpServer): SocketIOServer {
  const server = new SocketIOServer(httpServer, {
    cors: {
      origin:
        env.NODE_ENV === 'production'
          ? false
          : (origin, callback) => callback(null, origin || true),
      methods: ['GET', 'POST'],
    },
  })
  io = server

  server.on('connection', (socket) => {
    log.info(`Client connected: ${socket.id}`)
    emitAllShellClients(socket)
    emitCachedPRChecks(socket)
    refreshPRChecks()
    startGitDirtyPolling()
    socket.emit('services:status', getServicesStatus())

    // Bell subscriptions
    socket.emit('bell:subscriptions', getBellSubscribedShellIds())
    socket.on(
      'bell:subscribe',
      (data: {
        shellId: number
        terminalId: number
        command: string
        terminalName: string
      }) => {
        subscribeBell(data)
      },
    )
    socket.on('bell:unsubscribe', (data: { shellId: number }) => {
      unsubscribeBell(data.shellId)
    })

    socket.on('detect-branches', () => {
      detectAllTerminalBranches()
    })

    socket.on('zellij-attach', async (data: { terminalId: number }) => {
      const { terminalId } = data
      const session = getSessionByTerminalId(terminalId)
      if (!session) return
      const sessionName =
        session.sessionName ||
        (await getTerminalById(terminalId))?.name ||
        `terminal-${terminalId}`
      writeToSession(session.shell.id, `zellij attach '${sessionName}'\n`)
    })

    socket.on(
      'run-in-shell',
      async (data: {
        shellId: number
        command: string
        terminalId?: number
      }) => {
        const { shellId: targetShellId, command, terminalId } = data

        const ptySession = getSession(targetShellId)

        // If the PTY session doesn't exist yet (e.g. newly created shell),
        // queue the command to run after shell integration injection
        if (!ptySession) {
          setPendingCommand(targetShellId, command)
          return
        }

        const zellijName = terminalId
          ? ptySession.sessionName ||
            (await getTerminalById(terminalId))?.name ||
            `terminal-${terminalId}`
          : ptySession.sessionName
        const zellijSessions = await getActiveZellijSessionNames()
        const hasZellij = zellijName && zellijSessions.has(zellijName)

        if (hasZellij) {
          writeToSession(targetShellId, 'zellij action new-tab\n')
          setTimeout(() => {
            writeToSession(targetShellId, `${command}\n`)
          }, 300)
        } else {
          writeToSession(targetShellId, `${command}\n`)
        }
      },
    )

    socket.on(
      'kill-process',
      (data: { pid: number }, callback?: (result: { ok: boolean }) => void) => {
        const { pid } = data
        if (!pid || pid <= 0) {
          callback?.({ ok: false })
          return
        }
        try {
          process.kill(pid, 'SIGTERM')
          log.info(`[socket] Killed process ${pid}`)
          callback?.({ ok: true })
        } catch (err) {
          log.error({ err }, `[socket] Failed to kill process ${pid}`)
          callback?.({ ok: false })
        }
      },
    )

    socket.on('desktop:active', () => {
      markDesktopActive()
    })

    socket.on('disconnect', () => {
      log.info(`Client disconnected: ${socket.id}`)
    })
  })

  return server
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
