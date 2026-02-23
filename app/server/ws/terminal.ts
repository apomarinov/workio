import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { setPermissionNeededSessionDone } from '../db'
import { getIO } from '../io'
import { log } from '../logger'
import {
  attachSession,
  clearSessionTimeout,
  createSession,
  getSession,
  getSessionBuffer,
  resizeSession,
  startSessionTimeout,
  writeToSession,
} from '../pty/manager'

// Message types
interface InitMessage {
  type: 'init'
  shellId: number
  cols: number
  rows: number
}

interface InputMessage {
  type: 'input'
  data: string
}

interface ResizeMessage {
  type: 'resize'
  cols: number
  rows: number
}

type ClientMessage = InitMessage | InputMessage | ResizeMessage

interface OutputMessage {
  type: 'output'
  data: string
}

interface ExitMessage {
  type: 'exit'
  code: number
}

interface ErrorMessage {
  type: 'error'
  message: string
}

interface ReadyMessage {
  type: 'ready'
}

type ServerMessage = OutputMessage | ExitMessage | ErrorMessage | ReadyMessage

// Track which shell each WebSocket is connected to
const wsShellMap = new WeakMap<WebSocket, number>()

// Track all connected clients per shell for broadcasting output
const shellClients = new Map<number, Set<WebSocket>>()

// The primary client controls PTY dimensions — first to connect, promoted on disconnect
const shellPrimaryClient = new Map<number, WebSocket>()

// Each client's last known dimensions (for promoting a new primary)
const wsClientSize = new WeakMap<WebSocket, { cols: number; rows: number }>()

// Debounce resize events to prevent shell redraw spam during drag
const resizeTimers = new Map<number, ReturnType<typeof setTimeout>>()
const RESIZE_DEBOUNCE_MS = 500

// Create WebSocket server (noServer mode - we handle upgrades manually)
const wss = new WebSocketServer({ noServer: true })

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

// Batch rapid output chunks into a single broadcast to all connected clients
// (helps with TUI apps that emit many small writes)
function createBroadcastBatcher(shellId: number): (data: string) => void {
  let pending = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (pending) {
      const msg: ServerMessage = { type: 'output', data: pending }
      const clients = shellClients.get(shellId)
      if (clients) {
        for (const client of clients) {
          sendMessage(client, msg)
        }
      }
      pending = ''
    }
  }

  return (data: string) => {
    pending += data
    if (!timer) {
      timer = setTimeout(flush, 4)
    }
  }
}

// Broadcast exit to all connected clients for a shell
function broadcastExit(shellId: number, code: number): void {
  const clients = shellClients.get(shellId)
  if (clients) {
    for (const client of clients) {
      sendMessage(client, { type: 'exit', code })
    }
  }
}

wss.on('connection', (ws: WebSocket) => {
  let shellId: number | null = null

  ws.on('message', async (rawData) => {
    let message: ClientMessage
    try {
      message = JSON.parse(rawData.toString()) as ClientMessage
    } catch {
      sendMessage(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    switch (message.type) {
      case 'init': {
        shellId = message.shellId
        wsShellMap.set(ws, shellId)

        // Check if session already exists (reconnection)
        const existingSession = getSession(shellId)
        if (existingSession) {
          // Clear timeout since client reconnected
          clearSessionTimeout(shellId)

          // Add this client to the shell's client set
          let clients = shellClients.get(shellId)
          if (!clients) {
            // First client reconnecting — create the set and re-attach
            // with broadcast callbacks
            clients = new Set()
            shellClients.set(shellId, clients)
            const sid = shellId
            const batchOutput = createBroadcastBatcher(sid)
            attachSession(sid, batchOutput, (code) => {
              broadcastExit(sid, code)
            })
          }
          clients.add(ws)
          wsClientSize.set(ws, { cols: message.cols, rows: message.rows })

          // Latest client becomes primary (controls PTY dimensions)
          shellPrimaryClient.set(shellId, ws)

          // Replay buffer to this client only
          const buffer = getSessionBuffer(shellId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          // Send ready message
          sendMessage(ws, { type: 'ready' })

          // Resize PTY to the new primary's dimensions
          resizeSession(shellId, message.cols, message.rows)
          return
        }

        // Create new session — set up broadcast client set first
        const sid = shellId
        const clients = new Set<WebSocket>([ws])
        shellClients.set(sid, clients)
        shellPrimaryClient.set(sid, ws)
        wsClientSize.set(ws, { cols: message.cols, rows: message.rows })

        const batchOutput = createBroadcastBatcher(sid)
        const session = await createSession(
          sid,
          message.cols,
          message.rows,
          batchOutput,
          (code) => {
            broadcastExit(sid, code)
          },
        )

        if (!session) {
          sendMessage(ws, {
            type: 'error',
            message: 'Failed to create session',
          })
          return
        }

        // Send ready message
        sendMessage(ws, { type: 'ready' })
        break
      }

      case 'input': {
        if (shellId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        // Ctrl+C: if session is waiting for permission, mark it done
        if (message.data.includes('\x03')) {
          log.info(
            `[ws] Ctrl+C detected on shell=${shellId}, checking for permission_needed session`,
          )
          setPermissionNeededSessionDone(shellId)
            .then((sessionId) => {
              log.info(
                `[ws] setPermissionNeededSessionDone result: sessionId=${sessionId} shell=${shellId}`,
              )
              if (sessionId) {
                const io = getIO()
                io?.emit('session:updated', {
                  sessionId,
                  data: { status: 'done' },
                })
              }
            })
            .catch((err) => {
              log.error(
                { err },
                `[ws] Failed to check permission_needed for shell=${shellId}`,
              )
            })
        }
        writeToSession(shellId, message.data)
        break
      }

      case 'resize': {
        if (shellId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        const { cols, rows } = message
        // Always track this client's latest dimensions
        wsClientSize.set(ws, { cols, rows })

        // Only the primary client can resize the PTY
        if (shellPrimaryClient.get(shellId) !== ws) {
          break
        }

        // Debounce resize to prevent shell redraw spam during drag
        const sid = shellId
        const existingTimer = resizeTimers.get(sid)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }
        resizeTimers.set(
          sid,
          setTimeout(() => {
            resizeTimers.delete(sid)
            resizeSession(sid, cols, rows)
          }, RESIZE_DEBOUNCE_MS),
        )
        break
      }
    }
  })

  ws.on('close', () => {
    if (shellId !== null) {
      // Remove this client from the shell's set
      const clients = shellClients.get(shellId)
      if (clients) {
        clients.delete(ws)
        if (clients.size === 0) {
          // No clients left — clean up and start timeout
          shellClients.delete(shellId)
          shellPrimaryClient.delete(shellId)
          startSessionTimeout(shellId)
        } else if (shellPrimaryClient.get(shellId) === ws) {
          // Primary disconnected — promote next client and resize PTY
          const next = clients.values().next().value as WebSocket
          shellPrimaryClient.set(shellId, next)
          const size = wsClientSize.get(next)
          if (size) {
            resizeSession(shellId, size.cols, size.rows)
          }
        }
      }
    }
  })

  ws.on('error', (err) => {
    log.error({ err }, '[ws] WebSocket error')
  })
})

export function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  // Only handle /ws/terminal path
  const url = new URL(request.url || '', `http://${request.headers.host}`)
  if (url.pathname !== '/ws/terminal') {
    socket.destroy()
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
}

export { wss }
