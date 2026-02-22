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

// Batch rapid output chunks into a single message to reduce WebSocket overhead
// (helps with TUI apps that emit many small writes)
function createOutputBatcher(ws: WebSocket): (data: string) => void {
  let pending = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (pending) {
      sendMessage(ws, { type: 'output', data: pending })
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

          // Update callbacks to use the new WebSocket
          const batchOutput = createOutputBatcher(ws)
          attachSession(shellId, batchOutput, (code) => {
            sendMessage(ws, { type: 'exit', code })
          })

          // Replay buffer
          const buffer = getSessionBuffer(shellId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          // Send ready message
          sendMessage(ws, { type: 'ready' })

          // Force PTY resize to client dimensions — sends SIGWINCH to all
          // foreground processes (e.g. Zellij), triggering a full redraw.
          // Without this, TUI apps show stale buffer content and don't
          // respond to mouse/scroll after reconnection.
          resizeSession(shellId, message.cols, message.rows)
          return
        }

        // Create new session
        const batchOutput = createOutputBatcher(ws)
        const session = await createSession(
          shellId,
          message.cols,
          message.rows,
          batchOutput,
          (code) => {
            sendMessage(ws, { type: 'exit', code })
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
        // Debounce resize to prevent shell redraw spam during drag
        const sid = shellId
        const existingTimer = resizeTimers.get(sid)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }
        const { cols, rows } = message
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
      // Start timeout - session will be killed after 30 minutes
      startSessionTimeout(shellId)
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
