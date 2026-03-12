import fs from 'node:fs'
import { Client } from 'ssh2'
import { log } from '../logger'
import { type ResolvedSSHConfig, validateSSHHost } from './config'

// Max concurrent exec channels per pooled connection.
// Default OpenSSH MaxSessions is 10, and each PTY terminal also uses
// one session on the same server, so keep this low to avoid hitting
// the limit. Bump MaxSessions on the server for higher throughput.
const MAX_CHANNELS = 10

interface QueuedExec {
  resolve: (conn: Client) => void
  reject: (err: Error) => void
}

interface PoolEntry {
  conn: Client
  config: ResolvedSSHConfig
  state: 'connecting' | 'ready' | 'closed'
  connectPromise: Promise<Client> | null
  lastUsed: number
  activeChannels: number
  queue: QueuedExec[]
}

const pool = new Map<string, PoolEntry>()

const IDLE_CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes
const IDLE_TIMEOUT = 10 * 60 * 1000 // 10 minutes

// Periodic cleanup of idle connections
const idleCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [host, entry] of pool) {
    if (
      entry.state === 'ready' &&
      entry.activeChannels === 0 &&
      now - entry.lastUsed > IDLE_TIMEOUT
    ) {
      log.info(`[ssh-pool] Closing idle connection to ${host}`)
      entry.state = 'closed'
      entry.conn.end()
      pool.delete(host)
    }
  }
}, IDLE_CHECK_INTERVAL)
idleCleanupTimer.unref()

/** Drain queued waiters while under the channel limit */
function drainQueue(entry: PoolEntry) {
  while (entry.queue.length > 0 && entry.activeChannels < MAX_CHANNELS) {
    const waiter = entry.queue.shift()!
    entry.activeChannels++
    waiter.resolve(entry.conn)
  }
}

/** Release a channel slot and drain the queue */
function releaseChannel(sshHost: string) {
  const entry = pool.get(sshHost)
  if (!entry) return
  entry.activeChannels = Math.max(0, entry.activeChannels - 1)
  drainQueue(entry)
}

function createConnection(
  sshHost: string,
  config: ResolvedSSHConfig,
): Promise<Client> {
  const conn = new Client()

  const entry: PoolEntry = {
    conn,
    config,
    state: 'connecting',
    connectPromise: null,
    lastUsed: Date.now(),
    activeChannels: 0,
    queue: [],
  }

  const promise = new Promise<Client>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end()
      pool.delete(sshHost)
      reject(new Error(`SSH pool connection to ${sshHost} timed out`))
    }, 15_000)

    conn.on('ready', () => {
      clearTimeout(timer)
      entry.state = 'ready'
      entry.connectPromise = null
      log.info(`[ssh-pool] Connected to ${sshHost}`)
      resolve(conn)
    })

    conn.on('error', (err: Error) => {
      clearTimeout(timer)
      entry.state = 'closed'
      pool.delete(sshHost)
      for (const waiter of entry.queue) waiter.reject(err)
      entry.queue.length = 0
      log.error({ err }, `[ssh-pool] Connection error for ${sshHost}`)
      reject(err)
    })

    conn.on('end', () => {
      if (pool.get(sshHost) === entry) {
        pool.delete(sshHost)
      }
    })

    conn.on('close', () => {
      if (pool.get(sshHost) === entry) {
        pool.delete(sshHost)
        const closeErr = new Error(`SSH connection to ${sshHost} closed`)
        for (const waiter of entry.queue) waiter.reject(closeErr)
        entry.queue.length = 0
      }
    })

    const privateKey = fs.readFileSync(config.identityFile)
    conn.connect({
      host: config.hostname,
      port: config.port,
      username: config.user,
      privateKey,
      readyTimeout: 10_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      agent: process.env.SSH_AUTH_SOCK,
    })
  })

  entry.connectPromise = promise
  pool.set(sshHost, entry)
  return promise
}

export function getConnection(sshHost: string): Promise<Client> {
  const existing = pool.get(sshHost)

  if (existing) {
    if (existing.state === 'ready') {
      existing.lastUsed = Date.now()
      return Promise.resolve(existing.conn)
    }
    if (existing.state === 'connecting' && existing.connectPromise) {
      return existing.connectPromise
    }
    // Closed entry still in map — remove and reconnect
    pool.delete(sshHost)
  }

  const result = validateSSHHost(sshHost)
  if (!result.valid) {
    return Promise.reject(
      new Error(`SSH validation failed for ${sshHost}: ${result.error}`),
    )
  }

  return createConnection(sshHost, result.config)
}

/**
 * Acquire a channel slot on the pooled connection.
 * Resolves immediately if under the limit, otherwise queues.
 */
function acquireChannel(sshHost: string): Promise<Client> {
  return getConnection(sshHost).then((conn) => {
    const entry = pool.get(sshHost)
    if (!entry || entry.conn !== conn) return conn

    if (entry.activeChannels < MAX_CHANNELS) {
      entry.activeChannels++
      return conn
    }

    // Over the limit — queue
    log.info(
      `[ssh-pool] Channel limit reached for ${sshHost} (${entry.activeChannels}/${MAX_CHANNELS}), queuing (queue size: ${entry.queue.length + 1})`,
    )
    return new Promise<Client>((resolve, reject) => {
      entry.queue.push({ resolve, reject })
    })
  })
}

export interface PoolExecSSHOptions {
  cwd?: string
  timeout?: number
}

const DEFAULT_TIMEOUT = 15_000

export function poolExecSSHCommand(
  sshHost: string,
  command: string,
  options?: string | PoolExecSSHOptions,
): Promise<{ stdout: string; stderr: string }> {
  const cwd = typeof options === 'string' ? options : options?.cwd
  const timeout =
    (typeof options === 'object' ? options?.timeout : undefined) ??
    DEFAULT_TIMEOUT

  return new Promise((resolve, reject) => {
    acquireChannel(sshHost)
      .then((conn) => {
        let fullCommand = command
        if (cwd) {
          if (cwd.startsWith('~/')) {
            const rest = cwd.slice(2).replace(/'/g, "'\\''")
            fullCommand = `cd ~/'${rest}' && ${command}`
          } else if (cwd === '~') {
            fullCommand = `cd ~ && ${command}`
          } else {
            fullCommand = `cd '${cwd.replace(/'/g, "'\\''")}' && ${command}`
          }
        }

        const timer = setTimeout(() => {
          releaseChannel(sshHost)
          reject(new Error(`SSH command timed out after ${timeout}ms`))
        }, timeout)

        conn.exec(fullCommand, (err, channel) => {
          if (err) {
            clearTimeout(timer)
            releaseChannel(sshHost)
            // Only kill the connection for actual connection-level errors.
            // "Channel open failure" is a channel-level error (e.g. MaxSessions)
            // — the connection itself is still alive.
            const msg = err.message || ''
            if (
              !msg.includes('Channel open failure') &&
              !msg.includes('channel open')
            ) {
              const entry = pool.get(sshHost)
              if (entry?.conn === conn) {
                entry.state = 'closed'
                pool.delete(sshHost)
                conn.end()
              }
            }
            return reject(err)
          }

          let stdout = ''
          let stderr = ''

          channel.on('data', (data: Buffer) => {
            stdout += data.toString('utf-8')
          })

          channel.stderr.on('data', (data: Buffer) => {
            stderr += data.toString('utf-8')
          })

          channel.on('close', (code: number | null) => {
            clearTimeout(timer)
            releaseChannel(sshHost)
            const entry = pool.get(sshHost)
            if (entry) entry.lastUsed = Date.now()

            if (code !== 0) {
              const error = new Error(
                `SSH command exited with code ${code}: ${stderr.trim()}`,
              )
              ;(error as Error & { code: number | null }).code = code
              return reject(error)
            }
            resolve({ stdout, stderr })
          })
        })
      })
      .catch(reject)
  })
}

export function closeConnection(sshHost: string): void {
  const entry = pool.get(sshHost)
  if (entry) {
    entry.state = 'closed'
    pool.delete(sshHost)
    const err = new Error(`SSH connection to ${sshHost} closed`)
    for (const waiter of entry.queue) waiter.reject(err)
    entry.queue.length = 0
    try {
      entry.conn.end()
    } catch {
      // Already closed
    }
    log.info(`[ssh-pool] Closed connection to ${sshHost}`)
  }
}

export function closeAllConnections(): void {
  for (const [host, entry] of pool) {
    entry.state = 'closed'
    const err = new Error(`SSH connection to ${host} closed`)
    for (const waiter of entry.queue) waiter.reject(err)
    entry.queue.length = 0
    try {
      entry.conn.end()
    } catch {
      // Already closed
    }
    log.info(`[ssh-pool] Closed connection to ${host}`)
  }
  pool.clear()
}

/** Check if a host currently has an active pooled connection */
export function hasConnection(sshHost: string): boolean {
  const entry = pool.get(sshHost)
  return entry?.state === 'ready' || entry?.state === 'connecting'
}
