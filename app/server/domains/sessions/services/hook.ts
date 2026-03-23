import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { env } from '@server/env'
import { log } from '@server/logger'

const DAEMON_SOCK = path.join(env.ROOT_DIR, 'daemon.sock')
const MIRRORS_DIR = path.join(os.homedir(), '.workio', 'mirrors')

/**
 * Forward a message to the monitor daemon via Unix socket.
 * Same protocol as monitor.py: JSON line in, JSON line out.
 */
function forwardToDaemon(message: Record<string, unknown>) {
  return new Promise<string>((resolve, reject) => {
    const sock = net.createConnection(DAEMON_SOCK)
    sock.setTimeout(5000)

    const payload = `${JSON.stringify(message)}\n`
    let response = ''

    sock.on('connect', () => {
      sock.write(payload)
    })

    sock.on('data', (data) => {
      response += data.toString()
      if (response.includes('\n')) {
        sock.end()
      }
    })

    sock.on('end', () => {
      resolve(response.trim())
    })

    sock.on('error', (err) => {
      reject(err)
    })

    sock.on('timeout', () => {
      sock.destroy()
      reject(new Error('Daemon socket timeout'))
    })
  })
}

export async function handleClaudeHook(
  event: Record<string, unknown>,
  env: Record<string, string> | undefined,
  hostAlias: string,
  transcriptDelta: string | undefined,
  sessionIndex: Record<string, unknown> | undefined,
) {
  const sessionId =
    (event.session_id as string) || (event.sessionId as string) || ''

  // Rewrite transcript_path to local mirror path (even without delta,
  // so the daemon stores the correct local path for worker.py)
  if (sessionId) {
    const mirrorDir = path.join(MIRRORS_DIR, hostAlias)
    const mirrorPath = path.join(mirrorDir, `${sessionId}.jsonl`)
    event.transcript_path = mirrorPath

    // Append transcript delta if present
    if (transcriptDelta) {
      try {
        await fs.promises.mkdir(mirrorDir, { recursive: true })
        await fs.promises.appendFile(mirrorPath, transcriptDelta)
      } catch (err) {
        log.error(
          { err, sessionId, host_alias: hostAlias },
          '[claude-hook] Failed to mirror transcript',
        )
      }
    }
  }

  // Forward to daemon via Unix socket
  const daemonMessage = {
    event,
    env: env || {},
    host: hostAlias,
    session_index: sessionIndex || null,
  }
  await forwardToDaemon(daemonMessage)
}
