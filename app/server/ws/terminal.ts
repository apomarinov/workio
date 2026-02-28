import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { ShellClient } from '../../shared/types'
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
import { sendPushNotification } from '../push'

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
  code?: string
}

interface ReadyMessage {
  type: 'ready'
}

type ServerMessage = OutputMessage | ExitMessage | ErrorMessage | ReadyMessage

function parseUserAgent(ua: string): { device: string; browser: string } {
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

// Per-WebSocket metadata (set once at connection time)
interface WsClientInfo {
  ip: string
  device: string
  browser: string
  cols: number
  rows: number
}

const wsInfo = new WeakMap<WebSocket, WsClientInfo>()

// Per-shell state: all connected clients, keyed by IP for dedup
interface ShellState {
  // IP → WebSocket (one connection per device per shell)
  devices: Map<string, WebSocket>
  // All connected clients (same WebSocket refs as in devices.values())
  clients: Set<WebSocket>
  // The primary client controls PTY dimensions
  primary: WebSocket | null
}

const shells = new Map<number, ShellState>()

function getOrCreateShell(shellId: number): ShellState {
  let state = shells.get(shellId)
  if (!state) {
    state = { devices: new Map(), clients: new Set(), primary: null }
    shells.set(shellId, state)
  }
  return state
}

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
      const state = shells.get(shellId)
      if (state) {
        for (const client of state.clients) {
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
  const state = shells.get(shellId)
  if (state) {
    for (const client of state.clients) {
      sendMessage(client, { type: 'exit', code })
    }
  }
}

function broadcastShellClients(shellId: number): void {
  const state = shells.get(shellId)
  const clients: ShellClient[] = []
  if (state) {
    for (const ws of state.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      const info = wsInfo.get(ws)
      if (!info) continue
      clients.push({ device: info.device, browser: info.browser, ip: info.ip })
    }
  }
  const io = getIO()
  io?.emit('shell:clients', { shellId, clients })
}

wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  // Extract client IP from the upgrade request
  const forwarded = request.headers['x-forwarded-for']
  const clientIP =
    (typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : undefined) ??
    request.socket.remoteAddress ??
    'unknown'
  const ua = parseUserAgent(request.headers['user-agent'] ?? '')
  wsInfo.set(ws, {
    ip: clientIP,
    device: ua.device,
    browser: ua.browser,
    cols: 0,
    rows: 0,
  })

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
        const state = getOrCreateShell(shellId)

        // Reject duplicate connection from the same device (IP) for the same shell
        const existingDeviceWs = state.devices.get(clientIP)
        if (
          existingDeviceWs &&
          existingDeviceWs.readyState === WebSocket.OPEN
        ) {
          log.info(
            `[ws] Rejecting duplicate connection for shell=${shellId} from device=${clientIP}`,
          )
          sendMessage(ws, {
            type: 'error',
            code: 'already_connected',
            message: 'This shell is already open on your device',
          })
          ws.close()
          return
        }

        // Register this connection
        state.devices.set(clientIP, ws)
        const info = wsInfo.get(ws)!
        info.cols = message.cols
        info.rows = message.rows

        // Check if session already exists (reconnection)
        const existingSession = getSession(shellId)
        if (existingSession) {
          // Clear timeout since client reconnected
          clearSessionTimeout(shellId)

          // Re-attach broadcast callbacks if this is the first client reconnecting
          if (state.clients.size === 0) {
            const sid = shellId
            const batchOutput = createBroadcastBatcher(sid)
            attachSession(sid, batchOutput, (code) => {
              broadcastExit(sid, code)
            })
          }
          state.clients.add(ws)
          log.info(
            `[ws] Client connected to shell=${shellId} (reconnect), clients=${state.clients.size}`,
          )

          // Latest client becomes primary (controls PTY dimensions)
          state.primary = ws

          // Replay buffer to this client only
          const buffer = getSessionBuffer(shellId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          // Send ready message
          sendMessage(ws, { type: 'ready' })
          broadcastShellClients(shellId)

          // Resize PTY to the new primary's dimensions
          resizeSession(shellId, message.cols, message.rows)
          return
        }

        // Create new session
        const sid = shellId
        state.clients.add(ws)
        state.primary = ws

        log.info(
          `[ws] Client connected to shell=${sid} (new session), clients=1`,
        )

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
        broadcastShellClients(sid)
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
                // Dismiss the permission push notification
                sendPushNotification(
                  {
                    title: '',
                    body: '',
                    tag: `session:${sessionId}`,
                    action: 'dismiss',
                  },
                  { force: true },
                )
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
        const state = shells.get(shellId)

        // Always track this client's latest dimensions
        const info = wsInfo.get(ws)
        if (info) {
          info.cols = cols
          info.rows = rows
        }

        // Only the primary client can resize the PTY
        if (!state || state.primary !== ws) {
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
      const state = shells.get(shellId)
      if (!state) return

      // Clean up device tracking — only remove if this ws is still the registered one
      if (state.devices.get(clientIP) === ws) {
        state.devices.delete(clientIP)
      }

      // Remove this client from the shell's set
      state.clients.delete(ws)
      log.info(
        `[ws] Client disconnected from shell=${shellId}, clients=${state.clients.size}`,
      )

      if (state.clients.size === 0) {
        // No clients left — clean up and start timeout
        shells.delete(shellId)
        log.info(`[ws] No clients left for shell=${shellId}, starting timeout`)
        startSessionTimeout(shellId)
        broadcastShellClients(shellId)
      } else {
        if (state.primary === ws) {
          // Primary disconnected — promote next client and resize PTY
          const next = state.clients.values().next().value as WebSocket
          state.primary = next
          const nextInfo = wsInfo.get(next)
          if (nextInfo) {
            resizeSession(shellId, nextInfo.cols, nextInfo.rows)
          }
        }
        broadcastShellClients(shellId)
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
