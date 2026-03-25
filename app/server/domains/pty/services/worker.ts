/**
 * PTY Worker Process
 *
 * Child process entry point that owns a single PTY session.
 * Communicates with the master process via Node.js IPC (fork channel).
 */

import {
  type MasterToWorkerMessage,
  masterToWorkerMessageSchema,
  type WorkerInitConfig,
  type WorkerToMasterMessage,
} from '@domains/pty/schema'
import type { TerminalBackend } from '@server/ssh/ssh-pty-adapter'
import { createSSHSession } from '@server/ssh/ssh-pty-adapter'
import * as pty from 'node-pty'
import { createOscParser } from './osc-parser'
import { getChildPids } from './process-tree'

const MAX_BUFFER_LINES = 5000
// Monotonic counter for buffer chunks — used to ID bell events
let chunkIndex = 0

// ── State ───────────────────────────────────────────────────────────

let backend: TerminalBackend | null = null
let buffer: string[] = []
let pendingCommand: string | null = null
let onDoneMarker: ((exitCode: number) => void) | null = null
const seenBells = new Set<number>()
let shellId = 0
let terminalId = 0

// ── Helpers ─────────────────────────────────────────────────────────

function send(msg: WorkerToMasterMessage) {
  if (process.send) {
    process.send(msg)
  }
}

function workerLog(
  level: string,
  message: string,
  data?: Record<string, unknown>,
) {
  send({ type: 'log', level, message, data })
}

// ── Init ────────────────────────────────────────────────────────────

async function init(config: WorkerInitConfig) {
  shellId = config.shellId
  terminalId = config.terminalId

  try {
    if (config.sshHost && config.sshConfig) {
      // SSH terminal
      backend = await createSSHSession(
        config.sshConfig,
        config.cols,
        config.rows,
      )
    } else if (config.cwd && config.shell) {
      // Local terminal
      backend = pty.spawn(config.shell, [], {
        name: 'xterm-256color',
        cols: config.cols,
        rows: config.rows,
        cwd: config.cwd,
        env: (config.env || process.env) as Record<string, string>,
      })
    } else {
      send({ type: 'error', message: 'Invalid worker init config' })
      process.exit(1)
      return
    }
  } catch (err) {
    send({
      type: 'error',
      message: `Failed to spawn PTY: ${err instanceof Error ? err.message : String(err)}`,
    })
    process.exit(1)
    return
  }

  // Create OSC parser
  const oscParser = createOscParser(
    (data) => {
      chunkIndex++
      buffer.push(data)
      if (buffer.length > MAX_BUFFER_LINES) {
        buffer = buffer.slice(-MAX_BUFFER_LINES)
      }
      send({ type: 'data', data })
    },
    (event) => {
      switch (event.type) {
        case 'prompt': {
          send({ type: 'state-update', isIdle: true, currentCommand: null })
          send({ type: 'command-event', event })

          if (pendingCommand) {
            const cmd = pendingCommand
            pendingCommand = null
            setTimeout(() => {
              backend?.write(`${cmd}\n`)
            }, 200)
          }
          break
        }
        case 'done_marker':
          if (onDoneMarker) {
            const cb = onDoneMarker
            onDoneMarker = null
            cb(event.exitCode ?? 0)
          }
          send({ type: 'command-event', event })
          break
        case 'command_start':
          send({
            type: 'state-update',
            isIdle: false,
            currentCommand: event.command || null,
          })
          send({ type: 'command-event', event })
          break
        case 'command_end':
          send({ type: 'command-event', event })
          break
        case 'remote_pid':
          send({ type: 'command-event', event })
          break
      }
    },
    // Bell callback — ID by buffer chunk position
    () => {
      const pos = chunkIndex
      if (seenBells.has(pos)) return
      seenBells.add(pos)
      // Cap the set size to avoid unbounded growth
      if (seenBells.size > 1000) {
        const entries = [...seenBells]
        for (let i = 0; i < 500; i++) seenBells.delete(entries[i])
      }
      workerLog('info', `[bell] shell=${shellId} chunk=${pos}`)
      send({ type: 'bell', shellId, terminalId })
    },
  )

  // Wire PTY data through OSC parser
  backend.onData((data) => {
    oscParser(data)
  })

  // Handle PTY exit
  backend.onExit(({ exitCode }) => {
    send({ type: 'exit', code: exitCode })
    // Give time for the exit message to be sent
    setTimeout(() => process.exit(0), 100)
  })

  send({ type: 'ready', pid: backend.pid })

  // Inject shell integration
  if (config.sshHost && config.sshInlineScript) {
    setTimeout(() => {
      backend?.write(
        `export WORKIO_TERMINAL_ID=${config.terminalId} WORKIO_SHELL_ID=${shellId}\n`,
      )
      const injection = `eval "$(cat <<'__SHELL_INTEGRATION_EOF__'\n${config.sshInlineScript}\n__SHELL_INTEGRATION_EOF__\n)"\n`
      backend?.write(injection)
      if (config.cwd && config.cwd !== '~') {
        backend?.write(`cd ${config.cwd}\n`)
      }
      backend?.write('clear\n')
    }, 200)
  } else if (config.integrationScript) {
    setTimeout(() => {
      backend?.write(`source "${config.integrationScript}"\n`)
      backend?.write('clear\n')
    }, 100)
  }
}

// ── Message handler ─────────────────────────────────────────────────

process.on('message', async (raw: unknown) => {
  let msg: MasterToWorkerMessage
  try {
    msg = masterToWorkerMessageSchema.parse(raw)
  } catch (err) {
    workerLog(
      'error',
      `[worker] Invalid master→worker message: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  switch (msg.type) {
    case 'init':
      await init(msg.config)
      break

    case 'write':
      backend?.write(msg.data)
      break

    case 'resize':
      backend?.resize(msg.cols, msg.rows)
      break

    case 'kill':
      if (backend) {
        try {
          const pid = backend.pid
          if (pid && pid > 0) {
            try {
              process.kill(-pid, 'SIGTERM')
            } catch {
              // Process group may not exist
            }
            setTimeout(() => {
              try {
                process.kill(-pid, 'SIGKILL')
              } catch {
                // Already dead
              }
            }, 100)
          }
          backend.kill('SIGKILL')
        } catch {
          // Already dead
        }
      }
      setTimeout(() => process.exit(0), 200)
      break

    case 'interrupt':
      backend?.write('\x03')
      break

    case 'get-buffer':
      send({
        type: 'buffer-response',
        requestId: msg.requestId,
        buffer: [...buffer],
      })
      break

    case 'set-pending-command':
      pendingCommand = msg.command
      break

    case 'kill-children': {
      let success = false
      const pid = backend?.pid
      if (pid && pid > 0) {
        try {
          const childPids = await getChildPids(pid)
          for (const cpid of childPids) {
            try {
              process.kill(cpid, 'SIGKILL')
            } catch {
              // Already dead
            }
          }
          success = childPids.length > 0
        } catch {
          // Failed to get children
        }
      }
      send({
        type: 'kill-children-response',
        requestId: msg.requestId,
        success,
      })
      break
    }

    case 'update-session-name':
      // Acknowledged but not used locally — master tracks session name
      break
  }
})

// Handle graceful shutdown
process.on('SIGTERM', () => {
  if (backend) {
    try {
      backend.kill('SIGKILL')
    } catch {
      // Already dead
    }
  }
  process.exit(0)
})

// Unhandled errors - log and exit
process.on('uncaughtException', (err) => {
  workerLog('error', `[worker] Uncaught exception: ${err.message}`, {
    stack: err.stack,
  })
  process.exit(1)
})
