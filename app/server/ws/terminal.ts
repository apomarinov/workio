import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { ShellClient } from '../../shared/types'
import { resumePermissionSession, setActiveSessionDone } from '../db'
import { getIO, parseUserAgent } from '../io'
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
  fontSize?: number
  requestPrimary?: boolean
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

interface ClaimPrimaryMessage {
  type: 'claim-primary'
}

interface ReleasePrimaryMessage {
  type: 'release-primary'
}

type ClientMessage =
  | InitMessage
  | InputMessage
  | ResizeMessage
  | ClaimPrimaryMessage
  | ReleasePrimaryMessage

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
  isPrimary: boolean
  ptyCols: number
  ptyRows: number
  ptyFontSize?: number
}

interface PrimaryChangedMessage {
  type: 'primary-changed'
  isPrimary: boolean
  ptyCols: number
  ptyRows: number
  ptyFontSize?: number
}

type ServerMessage =
  | OutputMessage
  | ExitMessage
  | ErrorMessage
  | ReadyMessage
  | PrimaryChangedMessage

// Per-WebSocket metadata (set once at connection time)
interface WsClientInfo {
  ip: string
  device: string
  browser: string
  cols: number
  rows: number
  fontSize: number
  activeShellId: number | null
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
      // Only include clients that have this shell as their active shell
      if (info.activeShellId !== shellId) continue
      clients.push({
        device: info.device,
        browser: info.browser,
        ip: info.ip,
        isPrimary: ws === state.primary,
      })
    }
  }
  const io = getIO()
  io?.emit('shell:clients', { shellId, clients })
}

/**
 * Auto-release: when a client claims primary on a shell, release it from
 * all OTHER shells where the same IP is currently primary, and clear
 * activeShellId on that IP's WS for each other shell so the client count
 * only reflects clients actively viewing each shell.
 */
function autoReleaseOtherShells(clientIP: string, newShellId: number): void {
  for (const [shellId, state] of shells) {
    if (shellId === newShellId) continue

    // Clear activeShellId for this IP's WS on this shell regardless of primary
    const ipWs = state.devices.get(clientIP)
    if (ipWs) {
      const info = wsInfo.get(ipWs)
      if (info && info.activeShellId === shellId) {
        info.activeShellId = null
        broadcastShellClients(shellId)
      }
    }

    if (!state.primary) continue
    const primaryInfo = wsInfo.get(state.primary)
    if (!primaryInfo || primaryInfo.ip !== clientIP) continue

    // This shell has the same IP as primary — release it
    const releasedWs = state.primary
    let next: WebSocket | null = null
    for (const client of state.clients) {
      if (client !== releasedWs) {
        next = client
        break
      }
    }

    if (next) {
      state.primary = next
      const nextInfo = wsInfo.get(next)
      if (nextInfo && nextInfo.cols > 0 && nextInfo.rows > 0) {
        resizeSession(shellId, nextInfo.cols, nextInfo.rows)
      }
      const session = getSession(shellId)
      const ptyCols = session?.cols ?? nextInfo?.cols ?? 80
      const ptyRows = session?.rows ?? nextInfo?.rows ?? 24
      const ptyFontSize = nextInfo?.fontSize || undefined
      for (const client of state.clients) {
        sendMessage(client, {
          type: 'primary-changed',
          isPrimary: client === next,
          ptyCols,
          ptyRows,
          ptyFontSize,
        })
      }
    }
    // If no other client, the released WS stays primary (no one to promote to)

    broadcastShellClients(shellId)
  }
}

wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  // Extract client IP from the upgrade request
  const forwarded = request.headers['x-forwarded-for']
  let clientIP =
    (typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : undefined) ??
    request.socket.remoteAddress ??
    'unknown'
  // Normalize IPv6 localhost variants to a single value
  if (clientIP === '::1' || clientIP === '::ffff:127.0.0.1') {
    clientIP = '127.0.0.1'
  }
  const ua = parseUserAgent(request.headers['user-agent'] ?? '')
  wsInfo.set(ws, {
    ip: clientIP,
    device: ua.device,
    browser: ua.browser,
    cols: 0,
    rows: 0,
    fontSize: 0,
    activeShellId: null,
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
        info.fontSize = message.fontSize ?? 0

        // Check if session already exists (reconnection)
        const existingSession = getSession(shellId)
        const wantsPrimary = message.requestPrimary !== false
        if (wantsPrimary) {
          info.activeShellId = shellId
        }
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
            `[ws] Client connected to shell=${shellId} (reconnect, requestPrimary=${wantsPrimary}), clients=${state.clients.size}`,
          )

          // Replay buffer to this client only
          const buffer = await getSessionBuffer(shellId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          if (wantsPrimary || !state.primary) {
            // Client wants primary (or no primary exists) — promote it
            autoReleaseOtherShells(clientIP, shellId)
            const previousPrimary = state.primary
            state.primary = ws

            // Send ready message — new primary
            sendMessage(ws, {
              type: 'ready',
              isPrimary: true,
              ptyCols: existingSession.cols,
              ptyRows: existingSession.rows,
              ptyFontSize: message.fontSize || undefined,
            })

            // Demote the previous primary to scaled mode
            if (previousPrimary && previousPrimary !== ws) {
              const newFontSize = wsInfo.get(ws)?.fontSize || undefined
              sendMessage(previousPrimary, {
                type: 'primary-changed',
                isPrimary: false,
                ptyCols: message.cols,
                ptyRows: message.rows,
                ptyFontSize: newFontSize,
              })
            }

            // Resize PTY to the new primary's dimensions
            resizeSession(shellId, message.cols, message.rows)
          } else {
            // Client does NOT want primary and an existing primary exists — join passively
            const primaryInfo = wsInfo.get(state.primary)
            sendMessage(ws, {
              type: 'ready',
              isPrimary: false,
              ptyCols: existingSession.cols,
              ptyRows: existingSession.rows,
              ptyFontSize: primaryInfo?.fontSize || undefined,
            })
          }

          broadcastShellClients(shellId)
          return
        }

        // Create new session
        const sid = shellId
        state.clients.add(ws)
        state.primary = ws
        info.activeShellId = shellId

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

        // Send ready message — new session, so always primary
        sendMessage(ws, {
          type: 'ready',
          isPrimary: true,
          ptyCols: message.cols,
          ptyRows: message.rows,
          ptyFontSize: message.fontSize || undefined,
        })
        broadcastShellClients(sid)
        break
      }

      case 'input': {
        if (shellId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        // Enter: if session is in permission_needed, resume it to active
        if (message.data === '\r') {
          resumePermissionSession(shellId)
            .then((sessionId) => {
              if (sessionId) {
                log.info(
                  `[ws] Enter resumed permission_needed session=${sessionId} shell=${shellId}`,
                )
                const io = getIO()
                io?.emit('session:updated', {
                  sessionId,
                  data: { status: 'active' },
                })
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
                `[ws] Failed to resume permission_needed for shell=${shellId}`,
              )
            })
        }
        // Ctrl+C: if session is active, mark it done
        if (message.data.includes('\x03')) {
          log.info(
            `[ws] Ctrl+C detected on shell=${shellId}, checking for permission_needed session`,
          )
          setActiveSessionDone(shellId)
            .then((sessionId) => {
              log.info(
                `[ws] setActiveSessionDone result: sessionId=${sessionId} shell=${shellId}`,
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

      case 'claim-primary': {
        if (shellId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        const state = shells.get(shellId)
        if (!state) break

        const claimInfo = wsInfo.get(ws)
        if (claimInfo) claimInfo.activeShellId = shellId
        autoReleaseOtherShells(clientIP, shellId)
        state.primary = ws
        const info = wsInfo.get(ws)
        if (info && info.cols > 0 && info.rows > 0) {
          resizeSession(shellId, info.cols, info.rows)
        }

        // Notify all clients about the primary change
        const session = getSession(shellId)
        const ptyCols = session?.cols ?? info?.cols ?? 80
        const ptyRows = session?.rows ?? info?.rows ?? 24
        const ptyFontSize = info?.fontSize || undefined
        for (const client of state.clients) {
          sendMessage(client, {
            type: 'primary-changed',
            isPrimary: client === ws,
            ptyCols,
            ptyRows,
            ptyFontSize,
          })
        }
        broadcastShellClients(shellId)
        break
      }

      case 'release-primary': {
        if (shellId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        const state = shells.get(shellId)
        if (!state || state.primary !== ws) break

        // Promote another client (first one that isn't the current primary)
        let next: WebSocket | null = null
        for (const client of state.clients) {
          if (client !== ws) {
            next = client
            break
          }
        }

        if (next) {
          state.primary = next
          const nextInfo = wsInfo.get(next)
          if (nextInfo && nextInfo.cols > 0 && nextInfo.rows > 0) {
            resizeSession(shellId, nextInfo.cols, nextInfo.rows)
          }
          const session = getSession(shellId)
          const ptyCols = session?.cols ?? nextInfo?.cols ?? 80
          const ptyRows = session?.rows ?? nextInfo?.rows ?? 24
          const ptyFontSize = nextInfo?.fontSize || undefined
          for (const client of state.clients) {
            sendMessage(client, {
              type: 'primary-changed',
              isPrimary: client === next,
              ptyCols,
              ptyRows,
              ptyFontSize,
            })
          }
        }
        // If no other client, stay primary (nothing to release to)

        broadcastShellClients(shellId)
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
          // Notify all clients about the primary change
          const session = getSession(shellId)
          const ptyCols = session?.cols ?? nextInfo?.cols ?? 80
          const ptyRows = session?.rows ?? nextInfo?.rows ?? 24
          const ptyFontSize = nextInfo?.fontSize || undefined
          for (const client of state.clients) {
            sendMessage(client, {
              type: 'primary-changed',
              isPrimary: client === next,
              ptyCols,
              ptyRows,
              ptyFontSize,
            })
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
