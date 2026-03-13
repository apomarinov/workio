/**
 * Remote Claude Hook Forwarding — Bootstrap + Tunnel Management
 *
 * On first SSH terminal connection to a host, this module:
 * 1. Checks if Claude is installed on the remote (~/.claude/settings.json)
 * 2. Writes host config (~/.workio/config.json) on remote
 * 3. Copies the forwarder script (~/.workio/claude_forwarder.py) to remote
 * 4. Copies the wio Claude skill to remote (~/.claude/skills/wio/SKILL.md)
 * 5. Merges forwarder hooks into remote ~/.claude/settings.json
 * 6. Starts an SSH reverse tunnel (-R 18765:127.0.0.1:<SERVER_PORT>)
 *
 * One tunnel per host, regardless of how many shells are open.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../env'
import { log } from '../logger'
import { poolExecSSHCommand } from './pool'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')
const FORWARDER_PATH = path.join(PROJECT_ROOT, 'claude_forwarder.py')
const SKILL_PATH = path.join(PROJECT_ROOT, 'claude-skill', 'wio', 'SKILL.md')
const TUNNEL_PORT = 18765

interface HostState {
  status: 'setup' | 'done' | 'failed'
  tunnel: ChildProcess | null
  retries: number
}

const hostStates = new Map<string, HostState>()

const MAX_BOOTSTRAP_RETRIES = 5

// Whether the server is shutting down (suppress tunnel restarts)
let shuttingDown = false

/**
 * Hook event types that the forwarder handles.
 * Mirrors setup_hooks.py HOOK_DEFINITIONS.
 */
const HOOK_DEFINITIONS: Record<string, { matcher?: string }> = {
  SessionStart: {},
  UserPromptSubmit: {},
  PreToolUse: { matcher: '*' },
  PostToolUse: { matcher: '*' },
  Notification: { matcher: '*' },
  Stop: {},
  SessionEnd: {},
}

/**
 * Bootstrap a remote host for Claude hook forwarding.
 * No-ops if already setup or done.
 */
export async function bootstrapRemoteHost(hostAlias: string): Promise<void> {
  const existing = hostStates.get(hostAlias)
  if (existing && (existing.status === 'setup' || existing.status === 'done')) {
    return
  }

  const retries = existing?.retries ?? 0
  hostStates.set(hostAlias, { status: 'setup', tunnel: null, retries })

  try {
    // Step 1: Check if Claude is installed on remote
    try {
      await poolExecSSHCommand(hostAlias, 'test -f ~/.claude/settings.json', {
        timeout: 10000,
      })
    } catch {
      log.info(
        `[claude-fwd] Claude not installed on ${hostAlias}, skipping bootstrap`,
      )
      hostStates.set(hostAlias, { status: 'failed', tunnel: null, retries: hostStates.get(hostAlias)?.retries ?? 0 })
      return
    }

    // Step 2: Write host config on remote
    const configJson = JSON.stringify({ host_alias: hostAlias })
    await poolExecSSHCommand(
      hostAlias,
      `mkdir -p ~/.workio && printf '%s' '${configJson.replace(/'/g, "'\\''")}' > ~/.workio/config.json`,
      { timeout: 10000 },
    )

    // Step 3: Copy forwarder script via base64 over SSH
    try {
      const forwarderContent = await fs.promises.readFile(FORWARDER_PATH)
      const b64 = forwarderContent.toString('base64')
      await poolExecSSHCommand(
        hostAlias,
        `echo '${b64}' | base64 -d > ~/.workio/claude_forwarder.py && chmod +x ~/.workio/claude_forwarder.py`,
        { timeout: 15000 },
      )
    } catch (err) {
      log.error(
        { err },
        `[claude-fwd] Failed to copy forwarder to ${hostAlias}`,
      )
      hostStates.set(hostAlias, { status: 'failed', tunnel: null, retries: hostStates.get(hostAlias)?.retries ?? 0 })
      return
    }

    // Step 4: Copy wio Claude skill
    try {
      const skillContent = await fs.promises.readFile(SKILL_PATH, 'utf-8')
      const skillB64 = Buffer.from(skillContent).toString('base64')
      await poolExecSSHCommand(
        hostAlias,
        `mkdir -p ~/.claude/skills/wio && echo '${skillB64}' | base64 -d > ~/.claude/skills/wio/SKILL.md`,
        { timeout: 10000 },
      )
    } catch (err) {
      log.error({ err }, `[claude-fwd] Failed to copy skill to ${hostAlias}`)
      // Non-fatal — continue with hook setup
    }

    // Step 5: Merge forwarder hooks into remote settings.json
    try {
      const { stdout: settingsRaw } = await poolExecSSHCommand(
        hostAlias,
        'cat ~/.claude/settings.json',
        { timeout: 10000 },
      )
      const settings = JSON.parse(settingsRaw)
      if (!settings.hooks) settings.hooks = {}

      // Get remote home directory for absolute path
      const { stdout: homeRaw } = await poolExecSSHCommand(
        hostAlias,
        'echo $HOME',
        { timeout: 5000 },
      )
      const remoteHome = homeRaw.trim()
      const forwarderCommand = `${remoteHome}/.workio/claude_forwarder.py`

      let modified = false
      for (const [hookName, config] of Object.entries(HOOK_DEFINITIONS)) {
        if (!settings.hooks[hookName]) {
          settings.hooks[hookName] = []
        }

        const hookList = settings.hooks[hookName] as Record<string, unknown>[]
        const matcher = config.matcher ?? null

        // Check if forwarder hook already exists
        const exists = hookList.some((entry) => {
          if (matcher !== null && entry.matcher !== matcher) return false
          const hooks = (entry.hooks as Record<string, unknown>[]) || []
          return hooks.some(
            (h) => h.type === 'command' && h.command === forwarderCommand,
          )
        })

        if (!exists) {
          const entry: Record<string, unknown> = {
            hooks: [{ type: 'command', command: forwarderCommand }],
          }
          if (matcher !== null) entry.matcher = matcher
          hookList.push(entry)
          modified = true
        }
      }

      if (modified) {
        const updatedSettings = JSON.stringify(settings, null, 2)
        const b64Settings = Buffer.from(updatedSettings).toString('base64')
        await poolExecSSHCommand(
          hostAlias,
          `echo '${b64Settings}' | base64 -d > ~/.claude/settings.json`,
          { timeout: 10000 },
        )
        log.info(`[claude-fwd] Merged forwarder hooks on ${hostAlias}`)
      }
    } catch (err) {
      log.error({ err }, `[claude-fwd] Failed to merge hooks on ${hostAlias}`)
      hostStates.set(hostAlias, { status: 'failed', tunnel: null, retries: hostStates.get(hostAlias)?.retries ?? 0 })
      return
    }

    // Step 6: Start reverse tunnel
    startTunnel(hostAlias)

    const doneState = hostStates.get(hostAlias)
    if (doneState) {
      doneState.status = 'done'
      doneState.retries = 0
    }
    log.info(`[claude-fwd] Bootstrap complete for ${hostAlias}`)
  } catch (err) {
    log.error({ err }, `[claude-fwd] Bootstrap failed for ${hostAlias}`)
    hostStates.set(hostAlias, { status: 'failed', tunnel: null, retries: hostStates.get(hostAlias)?.retries ?? 0 })
  }

  // Auto-retry if bootstrap failed (any failure path, including inner catches)
  const state = hostStates.get(hostAlias)
  if (state?.status === 'failed' && !shuttingDown && state.retries < MAX_BOOTSTRAP_RETRIES) {
    state.retries++
    log.info(`[claude-fwd] Retrying bootstrap for ${hostAlias} (${state.retries}/${MAX_BOOTSTRAP_RETRIES})`)
    setTimeout(() => {
      if (!shuttingDown) {
        bootstrapRemoteHost(hostAlias).catch(() => {})
      }
    }, 5_000)
  }
}

/**
 * Start an SSH reverse tunnel for a host.
 * Port 18765 on remote → local SERVER_PORT.
 */
function startTunnel(hostAlias: string): void {
  const serverPort = env.SERVER_PORT
  const tunnel = spawn(
    'ssh',
    [
      '-N',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-R',
      `${TUNNEL_PORT}:127.0.0.1:${serverPort}`,
      hostAlias,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )

  tunnel.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.info(`[claude-fwd:tunnel:${hostAlias}] ${msg}`)
  })

  tunnel.on('exit', (code, signal) => {
    log.info(
      `[claude-fwd] Tunnel to ${hostAlias} exited (code=${code}, signal=${signal})`,
    )
    const state = hostStates.get(hostAlias)
    if (state) state.tunnel = null

    // Auto-restart unless shutting down
    if (!shuttingDown && state?.status === 'done') {
      log.info(`[claude-fwd] Restarting tunnel to ${hostAlias} in 5s`)
      setTimeout(() => {
        if (!shuttingDown && hostStates.get(hostAlias)?.status === 'done') {
          startTunnel(hostAlias)
        }
      }, 5000)
    }
  })

  const state = hostStates.get(hostAlias)
  if (state) state.tunnel = tunnel
  log.info(
    `[claude-fwd] Tunnel started: ${hostAlias} -R ${TUNNEL_PORT}:127.0.0.1:${serverPort}`,
  )
}

/**
 * Shut down all tunnels (called on server shutdown).
 */
export function shutdownAllTunnels(): void {
  shuttingDown = true
  for (const [hostAlias, state] of hostStates) {
    if (state.tunnel) {
      log.info(`[claude-fwd] Killing tunnel to ${hostAlias}`)
      state.tunnel.kill('SIGTERM')
      state.tunnel = null
    }
  }
  hostStates.clear()
}
