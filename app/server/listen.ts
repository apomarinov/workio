import { execFile } from 'node:child_process'
import pg from 'pg'
import type { Server as SocketIOServer } from 'socket.io'
import { getMessagesByIds, getTerminalById, updateSessionData } from './db'
import { log } from './logger'
import { execSSHCommand } from './ssh/exec'

function detectLocalBranch(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 5000 },
      (err, stdout) => {
        if (!err && stdout.trim()) return resolve(stdout.trim())
        // Fallback to symbolic-ref (for detached HEAD with a ref)
        execFile(
          'git',
          ['symbolic-ref', '--short', 'HEAD'],
          { cwd, timeout: 5000 },
          (err2, stdout2) => {
            if (err2) return reject(err2)
            resolve(stdout2.trim())
          },
        )
      },
    )
  })
}

async function detectSessionBranch(
  io: SocketIOServer,
  sessionId: string,
  terminalId: number | null,
  projectPath: string,
) {
  try {
    let branch: string

    if (terminalId) {
      const terminal = await getTerminalById(terminalId)
      if (terminal?.ssh_host) {
        const cmd =
          'git rev-parse --abbrev-ref HEAD 2>/dev/null || git symbolic-ref --short HEAD 2>/dev/null'
        const { stdout } = await execSSHCommand(terminal.ssh_host, cmd, {
          cwd: terminal.cwd,
        })
        branch = stdout.trim()
      } else {
        const cwd = terminal?.cwd || projectPath
        branch = await detectLocalBranch(cwd)
      }
    } else {
      branch = await detectLocalBranch(projectPath)
    }

    if (!branch) return

    await updateSessionData(sessionId, { branch })
    io.emit('session:updated', { sessionId, data: { branch } })
    log.info(`[listen] Detected branch="${branch}" for session=${sessionId}`)
  } catch (err) {
    log.error(
      { err, sessionId },
      '[listen] Failed to detect branch for session',
    )
  }
}

let listenerClient: pg.Client | null = null

export async function initPgListener(
  io: SocketIOServer,
  connectionString: string,
) {
  listenerClient = new pg.Client({ connectionString })
  await listenerClient.connect()

  await listenerClient.query('LISTEN hook')
  await listenerClient.query('LISTEN session_update')
  await listenerClient.query('LISTEN sessions_deleted')

  listenerClient.on('notification', async (msg) => {
    if (!msg.payload) return

    try {
      const payload = JSON.parse(msg.payload)

      if (msg.channel === 'hook') {
        io.emit('hook', payload)
        // log.info(`LISTEN: hook event session=${payload.session_id}`)

        if (payload.hook_type === 'SessionStart') {
          // Fire-and-forget branch detection
          detectSessionBranch(
            io,
            payload.session_id,
            payload.terminal_id ?? null,
            payload.project_path,
          )
        }
      }

      if (msg.channel === 'session_update') {
        const messages = await getMessagesByIds(payload.message_ids)
        io.emit('session_update', {
          session_id: payload.session_id,
          messages,
        })
        log.info(
          `LISTEN: session_update session=${payload.session_id} messages=${messages.length}`,
        )
      }

      if (msg.channel === 'sessions_deleted') {
        io.emit('sessions_deleted', payload)
        log.info(
          `LISTEN: sessions_deleted count=${payload.session_ids?.length}`,
        )
      }
    } catch (err) {
      log.error(
        { err, channel: msg.channel },
        'LISTEN: error processing notification',
      )
    }
  })

  listenerClient.on('error', (err) => {
    log.error({ err }, 'LISTEN: connection error, reconnecting...')
    listenerClient = null
    setTimeout(() => initPgListener(io, connectionString), 1000)
  })

  log.info(
    'LISTEN: connected to PostgreSQL, listening on [hook, session_update, sessions_deleted]',
  )
}
