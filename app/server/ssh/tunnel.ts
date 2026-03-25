import net from 'node:net'
import type { PortForwardStatus } from '@domains/pty/schema'
import { log } from '@server/logger'
import { getConnection } from './pool'

interface TunnelEntry {
  localPort: number
  remotePort: number
  sshHost: string
  terminalId: number
  server: net.Server
  connected: boolean
  error?: string
}

const tunnels = new Map<string, TunnelEntry>()

function tunnelKey(terminalId: number, remotePort: number): string {
  return `${terminalId}:${remotePort}`
}

function startTunnel(
  terminalId: number,
  sshHost: string,
  remotePort: number,
  localPort: number,
): void {
  const key = tunnelKey(terminalId, remotePort)
  if (tunnels.has(key)) return

  const entry: TunnelEntry = {
    localPort,
    remotePort,
    sshHost,
    terminalId,
    server: null!,
    connected: false,
  }

  const server = net.createServer((socket) => {
    getConnection(sshHost)
      .then((conn) => {
        conn.forwardOut(
          '127.0.0.1',
          localPort,
          '127.0.0.1',
          remotePort,
          (err, channel) => {
            if (err) {
              log.warn(
                `[ssh-tunnel] forwardOut failed for ${sshHost}:${remotePort}: ${err.message}`,
              )
              socket.destroy()
              return
            }
            socket.pipe(channel).pipe(socket)
            socket.on('error', () => channel.close())
            channel.on('error', () => socket.destroy())
          },
        )
      })
      .catch((err) => {
        log.warn(
          `[ssh-tunnel] getConnection failed for ${sshHost}: ${err.message}`,
        )
        socket.destroy()
      })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      entry.error = 'Port in use'
      entry.connected = false
      log.warn(
        `[ssh-tunnel] Local port ${localPort} already in use for ${sshHost}:${remotePort}`,
      )
    } else {
      entry.error = err.message
      entry.connected = false
      log.error(
        { err },
        `[ssh-tunnel] Server error for ${sshHost}:${remotePort}`,
      )
    }
  })

  server.listen(localPort, '127.0.0.1', () => {
    entry.connected = true
    entry.error = undefined
    log.info(
      `[ssh-tunnel] Forwarding localhost:${localPort} -> ${sshHost}:${remotePort} (terminal ${terminalId})`,
    )
  })

  entry.server = server
  tunnels.set(key, entry)
}

function stopTunnel(terminalId: number, remotePort: number): void {
  const key = tunnelKey(terminalId, remotePort)
  const entry = tunnels.get(key)
  if (!entry) return

  try {
    entry.server.close()
  } catch {}
  tunnels.delete(key)
  log.info(
    `[ssh-tunnel] Stopped forwarding localhost:${entry.localPort} -> ${entry.sshHost}:${remotePort} (terminal ${terminalId})`,
  )
}

export function reconcileTunnels(
  terminalId: number,
  sshHost: string,
  detectedPorts: number[],
  portMappings: { port: number; localPort: number }[],
): void {
  const detectedSet = new Set(detectedPorts)

  // Start tunnels for mappings where the remote port is detected and no tunnel exists
  for (const mapping of portMappings) {
    if (!detectedSet.has(mapping.port)) continue
    const key = tunnelKey(terminalId, mapping.port)
    const existing = tunnels.get(key)
    if (!existing) {
      startTunnel(terminalId, sshHost, mapping.port, mapping.localPort)
    } else if (existing.error && existing.error !== 'Port in use') {
      // Retry tunnels with stale errors (not EADDRINUSE which is persistent)
      stopTunnel(terminalId, mapping.port)
      startTunnel(terminalId, sshHost, mapping.port, mapping.localPort)
    }
  }

  // Stop tunnels where the remote port disappeared or mapping was removed
  const mappingPorts = new Set(portMappings.map((m) => m.port))
  for (const [, entry] of tunnels) {
    if (entry.terminalId !== terminalId) continue
    if (
      !detectedSet.has(entry.remotePort) ||
      !mappingPorts.has(entry.remotePort)
    ) {
      stopTunnel(terminalId, entry.remotePort)
    }
  }
}

export function getTunnelStatuses(terminalId: number): PortForwardStatus[] {
  const statuses: PortForwardStatus[] = []
  for (const entry of tunnels.values()) {
    if (entry.terminalId !== terminalId) continue
    statuses.push({
      remotePort: entry.remotePort,
      localPort: entry.localPort,
      connected: entry.connected,
      error: entry.error,
    })
  }
  return statuses
}

export function stopAllTunnelsForTerminal(terminalId: number): void {
  for (const [key, entry] of tunnels) {
    if (entry.terminalId !== terminalId) {
      continue
    }
    try {
      entry.server.close()
    } catch {}
    tunnels.delete(key)
  }
  log.info(`[ssh-tunnel] Stopped all tunnels for terminal ${terminalId}`)
}

export function stopAllTunnels(): void {
  for (const [, entry] of tunnels) {
    try {
      entry.server.close()
    } catch {}
  }
  tunnels.clear()
  log.info('[ssh-tunnel] Stopped all tunnels')
}
