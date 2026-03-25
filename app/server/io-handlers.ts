import type { Server as HttpServer } from 'node:http'
import { startGitDirtyPolling } from '@domains/git/services/status'
import {
  detectAllTerminalBranches,
  emitCachedPRChecks,
  refreshPRChecks,
} from '@domains/github/services/checks/polling'
import { markDesktopActive } from '@domains/notifications/service'
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

import { Server as SocketIOServer } from 'socket.io'
import { env } from './env'
import { setIO } from './io'
import serverEvents from './lib/events'
import { log } from './logger'
import { getServicesStatus } from './status'

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
  setIO(server)

  // Forward status updates from serverEvents to all Socket.IO clients
  serverEvents.on('services:status', (status) => {
    server.emit('services:status', status)
  })

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
