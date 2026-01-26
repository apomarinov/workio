import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
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
  terminalId: number
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

// Track which terminal each WebSocket is connected to
const wsTerminalMap = new WeakMap<WebSocket, number>()

// Create WebSocket server (noServer mode - we handle upgrades manually)
const wss = new WebSocketServer({ noServer: true })

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

wss.on('connection', (ws: WebSocket) => {
  let terminalId: number | null = null

  ws.on('message', (rawData) => {
    let message: ClientMessage
    try {
      message = JSON.parse(rawData.toString()) as ClientMessage
    } catch {
      sendMessage(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    switch (message.type) {
      case 'init': {
        terminalId = message.terminalId
        wsTerminalMap.set(ws, terminalId)

        // Check if session already exists (reconnection)
        const existingSession = getSession(terminalId)
        if (existingSession) {
          // Clear timeout since client reconnected
          clearSessionTimeout(terminalId)

          // Update callbacks to use the new WebSocket
          attachSession(
            terminalId,
            (data) => {
              sendMessage(ws, { type: 'output', data })
            },
            (code) => {
              sendMessage(ws, { type: 'exit', code })
            },
          )

          // Replay buffer
          const buffer = getSessionBuffer(terminalId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          // Send ready message
          sendMessage(ws, { type: 'ready' })
          return
        }

        // Create new session
        const session = createSession(
          terminalId,
          message.cols,
          message.rows,
          (data) => {
            sendMessage(ws, { type: 'output', data })
          },
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
        if (terminalId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        writeToSession(terminalId, message.data)
        break
      }

      case 'resize': {
        if (terminalId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        resizeSession(terminalId, message.cols, message.rows)
        break
      }
    }
  })

  ws.on('close', () => {
    if (terminalId !== null) {
      // Start timeout - session will be killed after 30 minutes
      startSessionTimeout(terminalId)
    }
  })

  ws.on('error', (err) => {
    console.error('[ws] WebSocket error:', err)
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
