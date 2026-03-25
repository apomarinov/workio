import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { sendPushNotification } from '@domains/notifications/service'
import {
  type ShellClient,
  type WsClientInfo,
  type WsClientMessage,
  type WsServerMessage,
  wsClientMessageSchema,
} from '@domains/pty/schema'
import {
  attachSession,
  clearSessionTimeout,
  createSession,
  getSession,
  getSessionBuffer,
  resizeSession,
  startSessionTimeout,
  writeToSession,
} from '@domains/pty/session'
import {
  resumePermissionSession,
  setActiveSessionDone,
} from '@domains/sessions/db'
import { getIO, parseUserAgent } from '@server/io'
import { log } from '@server/logger'
import { WebSocket, WebSocketServer } from 'ws'

// ── ShellClients class ─────────────────────────────────────────────

const RESIZE_DEBOUNCE_MS = 500
const BATCH_INTERVAL_MS = 4

export class ShellClients {
  readonly shellId: number
  devices = new Map<string, WebSocket>()
  clients = new Set<WebSocket>()
  primary: WebSocket | null = null
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private batchPending = ''

  constructor(shellId: number) {
    this.shellId = shellId
  }

  // Batched output broadcast
  broadcast(data: string) {
    this.batchPending += data
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null
        if (this.batchPending) {
          const msg: WsServerMessage = {
            type: 'output',
            data: this.batchPending,
          }
          for (const client of this.clients) {
            sendMessage(client, msg)
          }
          this.batchPending = ''
        }
      }, BATCH_INTERVAL_MS)
    }
  }

  broadcastExit(code: number) {
    for (const client of this.clients) {
      sendMessage(client, { type: 'exit', code })
    }
  }

  getClientsList(): ShellClient[] {
    const clients: ShellClient[] = []
    const seen = new Set<string>()
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      const info = wsInfo.get(ws)
      if (!info) continue
      if (info.activeShellId !== this.shellId) continue
      if (seen.has(info.ip)) continue
      seen.add(info.ip)
      clients.push({
        device: info.device,
        browser: info.browser,
        ip: info.ip,
        isPrimary: ws === this.primary,
      })
    }
    return clients
  }

  queueResize(cols: number, rows: number) {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
    }
    const sid = this.shellId
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null
      resizeSession(sid, cols, rows)
    }, RESIZE_DEBOUNCE_MS)
  }

  dispose() {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }
}

// ── Module-level state ─────────────────────────────────────────────

const shellClients = new Map<number, ShellClients>()
const wsInfo = new WeakMap<WebSocket, WsClientInfo>()
const wss = new WebSocketServer({ noServer: true })

// ── Module-level helpers (exported) ────────────────────────────────

export function getOrCreateShellClients(shellId: number): ShellClients {
  let sc = shellClients.get(shellId)
  if (!sc) {
    sc = new ShellClients(shellId)
    shellClients.set(shellId, sc)
  }
  return sc
}

/** Emit current shell:clients state for all active shells to a specific socket. */
export function emitAllShellClients(socket: {
  emit: (ev: string, data: unknown) => void
}): void {
  for (const [shellId, sc] of shellClients) {
    const clients = sc.getClientsList()
    if (clients.length > 0) {
      socket.emit('shell:clients', { shellId, clients })
    }
  }
}

// ── Internal helpers ───────────────────────────────────────────────

function sendMessage(ws: WebSocket, message: WsServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

function broadcastShellClients(shellId: number) {
  const sc = shellClients.get(shellId)
  if (!sc) return
  const io = getIO()
  io?.emit('shell:clients', { shellId, clients: sc.getClientsList() })
}

/**
 * Auto-release: when a client claims primary on a shell, release it from
 * all OTHER shells where the same IP is currently primary, and clear
 * activeShellId on that IP's WS for each other shell so the client count
 * only reflects clients actively viewing each shell.
 */
function autoReleaseOtherShells(clientIP: string, newShellId: number) {
  for (const [shellId, sc] of shellClients) {
    if (shellId === newShellId) continue

    // Clear activeShellId for this IP's WS on this shell regardless of primary
    const ipWs = sc.devices.get(clientIP)
    if (ipWs) {
      const info = wsInfo.get(ipWs)
      if (info && info.activeShellId === shellId) {
        info.activeShellId = null
        broadcastShellClients(shellId)
      }
    }

    if (!sc.primary) continue
    const primaryInfo = wsInfo.get(sc.primary)
    if (!primaryInfo || primaryInfo.ip !== clientIP) continue

    // This shell has the same IP as primary — release it
    const releasedWs = sc.primary
    let next: WebSocket | null = null
    for (const client of sc.clients) {
      if (client !== releasedWs) {
        next = client
        break
      }
    }

    if (next) {
      sc.primary = next
      const nextInfo = wsInfo.get(next)
      if (nextInfo && nextInfo.cols > 0 && nextInfo.rows > 0) {
        resizeSession(shellId, nextInfo.cols, nextInfo.rows)
      }
      const session = getSession(shellId)
      const ptyCols = session?.cols ?? nextInfo?.cols ?? 80
      const ptyRows = session?.rows ?? nextInfo?.rows ?? 24
      const ptyFontSize = nextInfo?.fontSize || undefined
      for (const client of sc.clients) {
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

// ── WebSocket connection handler ───────────────────────────────────

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
    let message: WsClientMessage
    try {
      message = wsClientMessageSchema.parse(JSON.parse(rawData.toString()))
    } catch (err) {
      log.error({ err }, '[ws] Invalid client message')
      sendMessage(ws, { type: 'error', message: 'Invalid message' })
      return
    }

    switch (message.type) {
      case 'init': {
        shellId = message.shellId
        const sc = getOrCreateShellClients(shellId)

        // Handle duplicate connection from the same device (IP) for the same shell
        const existingDeviceWs = sc.devices.get(clientIP)
        if (existingDeviceWs) {
          if (existingDeviceWs.readyState === WebSocket.OPEN) {
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
          // Stale WS (CLOSING/CLOSED) — clean it up so the new connection can proceed
          sc.clients.delete(existingDeviceWs)
          wsInfo.delete(existingDeviceWs)
        }

        // Register this connection
        sc.devices.set(clientIP, ws)
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
          if (sc.clients.size === 0) {
            const sid = shellId
            const scRef = sc
            attachSession(
              sid,
              (data) => scRef.broadcast(data),
              (code) => scRef.broadcastExit(code),
            )
          }
          sc.clients.add(ws)
          log.info(
            `[ws] Client connected to shell=${shellId} (reconnect, requestPrimary=${wantsPrimary}), clients=${sc.clients.size}`,
          )

          // Replay buffer to this client only
          const buffer = await getSessionBuffer(shellId)
          for (const data of buffer) {
            sendMessage(ws, { type: 'output', data })
          }

          if (wantsPrimary || !sc.primary) {
            // Client wants primary (or no primary exists) — promote it
            autoReleaseOtherShells(clientIP, shellId)
            const previousPrimary = sc.primary
            sc.primary = ws

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
            const primaryInfo = wsInfo.get(sc.primary)
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
        sc.clients.add(ws)
        sc.primary = ws
        info.activeShellId = shellId

        log.info(
          `[ws] Client connected to shell=${sid} (new session), clients=1`,
        )

        const scRef = sc
        const session = await createSession(
          sid,
          message.cols,
          message.rows,
          (data) => scRef.broadcast(data),
          (code) => scRef.broadcastExit(code),
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
        const sc = shellClients.get(shellId)

        // Always track this client's latest dimensions
        const info = wsInfo.get(ws)
        if (info) {
          info.cols = cols
          info.rows = rows
        }

        // Only the primary client can resize the PTY
        if (!sc || sc.primary !== ws) {
          break
        }

        sc.queueResize(cols, rows)
        break
      }

      case 'claim-primary': {
        if (shellId === null) {
          sendMessage(ws, { type: 'error', message: 'Not initialized' })
          return
        }
        const sc = shellClients.get(shellId)
        if (!sc) break

        const claimInfo = wsInfo.get(ws)
        if (claimInfo) claimInfo.activeShellId = shellId
        autoReleaseOtherShells(clientIP, shellId)
        sc.primary = ws
        const info = wsInfo.get(ws)
        if (info && info.cols > 0 && info.rows > 0) {
          resizeSession(shellId, info.cols, info.rows)
        }

        // Notify all clients about the primary change
        const session = getSession(shellId)
        const ptyCols = session?.cols ?? info?.cols ?? 80
        const ptyRows = session?.rows ?? info?.rows ?? 24
        const ptyFontSize = info?.fontSize || undefined
        for (const client of sc.clients) {
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
        const sc = shellClients.get(shellId)
        if (!sc || sc.primary !== ws) break

        // Promote another client (first one that isn't the current primary)
        let next: WebSocket | null = null
        for (const client of sc.clients) {
          if (client !== ws) {
            next = client
            break
          }
        }

        if (next) {
          sc.primary = next
          const nextInfo = wsInfo.get(next)
          if (nextInfo && nextInfo.cols > 0 && nextInfo.rows > 0) {
            resizeSession(shellId, nextInfo.cols, nextInfo.rows)
          }
          const session = getSession(shellId)
          const ptyCols = session?.cols ?? nextInfo?.cols ?? 80
          const ptyRows = session?.rows ?? nextInfo?.rows ?? 24
          const ptyFontSize = nextInfo?.fontSize || undefined
          for (const client of sc.clients) {
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
      const sc = shellClients.get(shellId)
      if (!sc) return

      // Clean up device tracking — only remove if this ws is still the registered one
      if (sc.devices.get(clientIP) === ws) {
        sc.devices.delete(clientIP)
      }

      // Remove this client from the shell's set
      sc.clients.delete(ws)
      log.info(
        `[ws] Client disconnected from shell=${shellId}, clients=${sc.clients.size}`,
      )

      if (sc.clients.size === 0) {
        // No clients left — clean up and start timeout
        sc.dispose()
        shellClients.delete(shellId)
        log.info(`[ws] No clients left for shell=${shellId}, starting timeout`)
        startSessionTimeout(shellId)
        broadcastShellClients(shellId)
      } else {
        if (sc.primary === ws) {
          // Primary disconnected — promote next client and resize PTY
          const next = sc.clients.values().next().value as WebSocket
          sc.primary = next
          const nextInfo = wsInfo.get(next)
          if (nextInfo) {
            resizeSession(shellId, nextInfo.cols, nextInfo.rows)
          }
          // Notify all clients about the primary change
          const session = getSession(shellId)
          const ptyCols = session?.cols ?? nextInfo?.cols ?? 80
          const ptyRows = session?.rows ?? nextInfo?.rows ?? 24
          const ptyFontSize = nextInfo?.fontSize || undefined
          for (const client of sc.clients) {
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

// ── handleUpgrade (exported) ───────────────────────────────────────

export function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
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
