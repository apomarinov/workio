import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
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

// Coalesce rapid PTY output chunks into fewer WebSocket messages.
// TUI apps like Zellij emit many small chunks per redraw; sending each
// as a separate JSON frame floods the client and causes visible stutter.
const OUTPUT_BATCH_MS = 4

function createOutputBatcher(ws: WebSocket): (data: string) => void {
  let pending: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    timer = null
    if (pending.length > 0) {
      const data = pending.join('')
      pending = []
      sendMessage(ws, { type: 'output', data })
    }
  }

  return (data: string) => {
    pending.push(data)
    if (timer === null) {
      timer = setTimeout(flush, OUTPUT_BATCH_MS)
    }
  }
}

wss.on('connection', (ws: WebSocket) => {
  let terminalId: number | null = null

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
        terminalId = message.terminalId
        wsTerminalMap.set(ws, terminalId)

        // Check if session already exists (reconnection)
        const existingSession = getSession(terminalId)
        if (existingSession) {
          // Clear timeout since client reconnected
          clearSessionTimeout(terminalId)

          // Update callbacks to use the new WebSocket
          const batchOutput = createOutputBatcher(ws)
          attachSession(terminalId, batchOutput, (code) => {
            sendMessage(ws, { type: 'exit', code })
          })

          // Replay buffer
          const buffer = getSessionBuffer(terminalId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          // Send ready message
          sendMessage(ws, { type: 'ready' })

          // Force PTY resize to client dimensions — sends SIGWINCH to all
          // foreground processes (e.g. Zellij), triggering a full redraw.
          // Without this, TUI apps show stale buffer content and don't
          // respond to mouse/scroll after reconnection.
          resizeSession(terminalId, message.cols, message.rows)
          return
        }

        // Create new session
        const batchOutput = createOutputBatcher(ws)
        const session = await createSession(
          terminalId,
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
        // Debounce resize to prevent shell redraw spam during drag
        const tid = terminalId
        const existingTimer = resizeTimers.get(tid)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }
        const { cols, rows } = message
        resizeTimers.set(
          tid,
          setTimeout(() => {
            resizeTimers.delete(tid)
            resizeSession(tid, cols, rows)
          }, RESIZE_DEBOUNCE_MS),
        )
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
