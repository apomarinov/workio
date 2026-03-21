import { resolveNotification } from '@domains/notifications/registry'
import { sendPushNotification } from '@domains/notifications/service'
import { scanAndStorePermissionPrompt } from '@domains/pty/services/permission-scanner'
import { getTerminalById } from '@domains/workspace/db/terminals'
import pg from 'pg'
import type { Server as SocketIOServer } from 'socket.io'
import {
  getActivePermissions,
  getMessagesByIds,
  getSessionById,
  updateSessionData,
} from './db'
import { execFileAsync } from './lib/exec'
import { log } from './logger'
import { execSSHCommand } from './ssh/exec'

async function detectLocalBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 5000 },
    )
    if (stdout.trim()) return stdout.trim()
  } catch {
    // Fall through to symbolic-ref
  }
  const { stdout } = await execFileAsync(
    'git',
    ['symbolic-ref', '--short', 'HEAD'],
    { cwd, timeout: 5000 },
  )
  return stdout.trim()
}

async function detectSessionBranch(
  io: SocketIOServer,
  sessionId: string,
  terminalId: number | null,
  projectPath: string,
) {
  try {
    let branch: string
    const terminal = terminalId ? await getTerminalById(terminalId) : null

    if (terminal) {
      if (terminal.ssh_host) {
        const cmd =
          'git rev-parse --abbrev-ref HEAD 2>/dev/null || git symbolic-ref --short HEAD 2>/dev/null'
        const { stdout } = await execSSHCommand(terminal.ssh_host, cmd, {
          cwd: terminal.cwd,
        })
        branch = stdout.trim()
      } else {
        const cwd = terminal.cwd || projectPath
        branch = await detectLocalBranch(cwd)
      }
    } else {
      branch = await detectLocalBranch(projectPath)
    }

    if (!branch) return

    const repo = terminal?.git_repo?.repo ?? ''

    // Build unique branches list
    const existing = await getSessionById(sessionId)
    let branches = existing?.data?.branches ?? []

    // Backfill old branch if it was set before branches tracking existed
    const oldBranch = existing?.data?.branch
    if (oldBranch && !branches.some((e) => e.branch === oldBranch)) {
      branches = [...branches, { branch: oldBranch, repo }]
    }

    if (!branches.some((e) => e.branch === branch && e.repo === repo)) {
      branches = [...branches, { branch, repo }]
    }

    const data = { branch, repo, branches }
    await updateSessionData(sessionId, data)
    io.emit('session:updated', { sessionId, data })
    log.info(
      `[listen] Detected branch="${branch}" repo="${repo}" for session=${sessionId}`,
    )
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

        if (!payload.terminal_id) {
          return
        }

        // Push notification for permission_needed is sent after the buffer scan
        // completes (see setTimeout block below) so it includes enriched data.

        // Send push notification for Stop events
        if (payload.hook_type === 'Stop') {
          const terminal = payload.terminal_id
            ? await getTerminalById(payload.terminal_id)
            : null
          const resolved = resolveNotification('stop', {
            terminalName: terminal?.name || 'Claude',
            lastMessage: payload.last_message || '',
          })
          sendPushNotification({
            title: `${resolved.emoji} ${resolved.title}`,
            body: resolved.body,
            tag: payload.session_id
              ? `session:${payload.session_id}`
              : undefined,
            data: {
              type: 'stop',
              terminalId: payload.terminal_id,
              shellId: payload.shell_id,
              sessionId: payload.session_id,
            },
          })
        }

        // Scan terminal buffer for permission prompts when status changes,
        // then send enriched push + web notifications with actual permission details
        if (payload.status === 'permission_needed') {
          log.info(
            `LISTEN: permission_needed session=${payload.session_id} shell_id=${payload.shell_id}`,
          )
          if (payload.shell_id) {
            // Retry with exponential backoff — the buffer may not have
            // the full permission prompt yet when the LISTEN fires.
            const DELAYS = [200, 200, 300, 800, 800, 1000, 1000]
            const tryEnrich = async (attempt: number) => {
              const parsed = await scanAndStorePermissionPrompt(
                payload.session_id,
                payload.shell_id,
              )

              if (!parsed && attempt < DELAYS.length - 1) {
                setTimeout(() => tryEnrich(attempt + 1), DELAYS[attempt + 1])
                return
              }

              // Build enriched notification from active permissions
              let userMessage = ''
              let permissionDetail = ''
              try {
                const perms = await getActivePermissions()
                const perm = perms.find(
                  (p) => p.session_id === payload.session_id,
                )
                if (perm) {
                  userMessage = perm.latest_user_message || ''
                  const tools = perm.tools as Record<string, unknown>
                  if (perm.source === 'ask_user_question') {
                    const input = tools.input as
                      | { questions?: { question?: string }[] }
                      | undefined
                    const questions = input?.questions ?? []
                    permissionDetail = questions
                      .map((q) => q.question)
                      .filter(Boolean)
                      .join('\n')
                  } else {
                    // terminal_prompt (tool_permission or plan_mode)
                    const permType = tools.type as string | undefined
                    if (permType === 'plan_mode') {
                      permissionDetail = 'Plan ready'
                    } else {
                      // tool_permission — use context or title
                      const ctx = tools.context as string | undefined
                      const title = tools.title as string | undefined
                      permissionDetail =
                        `${(title || '').trim()}\n${(ctx || '').trim()}`.trim()
                    }
                  }
                }
              } catch (err) {
                log.error(
                  { err },
                  '[listen] Failed to build enriched notification',
                )
              }

              // Send push notification with enriched content
              const resolved = resolveNotification('permission_needed', {
                userMessage,
                permissionDetail,
              })
              sendPushNotification({
                title: `${resolved.emoji} ${resolved.title}`,
                body: resolved.body,
                tag: payload.session_id
                  ? `session:${payload.session_id}`
                  : undefined,
                data: {
                  type: 'permission_needed',
                  terminalId: payload.terminal_id,
                  shellId: payload.shell_id,
                  sessionId: payload.session_id,
                },
              })

              // Emit enriched event for web clients
              io.emit('permission_notification', {
                session_id: payload.session_id,
                shell_id: payload.shell_id,
                terminal_id: payload.terminal_id,
                project_path: payload.project_path,
                userMessage,
                permissionDetail,
              })
            }
            setTimeout(() => tryEnrich(0), DELAYS[0])
          }
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
