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
import { resolveStableHostId } from './config'
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
  tunnelRetries: number
  alias: string
}

const hostStates = new Map<string, HostState>()

const MAX_BOOTSTRAP_RETRIES = 5
const MAX_TUNNEL_RETRIES = 5

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
  const stableId = resolveStableHostId(hostAlias)
  if (!stableId) {
    log.error(`[claude-fwd] Cannot resolve stable host ID for ${hostAlias}`)
    return
  }

  const existing = hostStates.get(stableId)
  if (existing && (existing.status === 'setup' || existing.status === 'done')) {
    return
  }

  const retries = existing?.retries ?? 0
  hostStates.set(stableId, {
    status: 'setup',
    tunnel: null,
    retries,
    tunnelRetries: 0,
    alias: hostAlias,
  })

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
      hostStates.set(stableId, {
        status: 'failed',
        tunnel: null,
        retries: hostStates.get(stableId)?.retries ?? 0,
        tunnelRetries: 0,
        alias: hostAlias,
      })
      return
    }

    // Step 2: Write host config on remote (use stable ID so project lookups survive alias renames)
    const configJson = JSON.stringify({ host_alias: stableId })
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
      hostStates.set(stableId, {
        status: 'failed',
        tunnel: null,
        retries: hostStates.get(stableId)?.retries ?? 0,
        tunnelRetries: 0,
        alias: hostAlias,
      })
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
      hostStates.set(stableId, {
        status: 'failed',
        tunnel: null,
        retries: hostStates.get(stableId)?.retries ?? 0,
        tunnelRetries: 0,
        alias: hostAlias,
      })
      return
    }

    // Step 6: Start reverse tunnel (uses alias for SSH CLI)
    await startTunnel(stableId)

    const doneState = hostStates.get(stableId)
    if (doneState) {
      doneState.status = 'done'
      doneState.retries = 0
    }
    log.info(`[claude-fwd] Bootstrap complete for ${hostAlias} (${stableId})`)
  } catch (err) {
    log.error({ err }, `[claude-fwd] Bootstrap failed for ${hostAlias}`)
    hostStates.set(stableId, {
      status: 'failed',
      tunnel: null,
      retries: hostStates.get(stableId)?.retries ?? 0,
      tunnelRetries: 0,
      alias: hostAlias,
    })
  }

  // Auto-retry if bootstrap failed (any failure path, including inner catches)
  const state = hostStates.get(stableId)
  if (
    state?.status === 'failed' &&
    !shuttingDown &&
    state.retries < MAX_BOOTSTRAP_RETRIES
  ) {
    state.retries++
    log.info(
      `[claude-fwd] Retrying bootstrap for ${hostAlias} (${state.retries}/${MAX_BOOTSTRAP_RETRIES})`,
    )
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
 * Kills any stale listener on the remote port before connecting.
 * @param stableId - The stable host identifier (user@hostname[:port]) used as map key
 */
async function startTunnel(stableId: string): Promise<void> {
  const state = hostStates.get(stableId)
  if (!state) return
  const { alias } = state

  // Kill any stale process holding the tunnel port on the remote
  try {
    await poolExecSSHCommand(
      alias,
      `fuser -k ${TUNNEL_PORT}/tcp 2>/dev/null || true`,
      { timeout: 5000 },
    )
  } catch {
    // Best-effort — fuser may not be installed
  }

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
      alias,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )

  tunnel.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.info(`[claude-fwd:tunnel:${alias}] ${msg}`)
  })

  tunnel.on('exit', (code, signal) => {
    log.info(
      `[claude-fwd] Tunnel to ${alias} exited (code=${code}, signal=${signal})`,
    )
    const currentState = hostStates.get(stableId)
    if (currentState) currentState.tunnel = null

    // Auto-restart unless shutting down or retries exhausted
    if (!shuttingDown && currentState?.status === 'done') {
      currentState.tunnelRetries++
      if (currentState.tunnelRetries > MAX_TUNNEL_RETRIES) {
        log.error(
          `[claude-fwd] Tunnel to ${alias} failed ${MAX_TUNNEL_RETRIES} times, giving up`,
        )
        return
      }
      const delay = Math.min(5000 * currentState.tunnelRetries, 30000)
      log.info(
        `[claude-fwd] Restarting tunnel to ${alias} in ${delay / 1000}s (${currentState.tunnelRetries}/${MAX_TUNNEL_RETRIES})`,
      )
      setTimeout(() => {
        if (!shuttingDown && hostStates.get(stableId)?.status === 'done') {
          startTunnel(stableId)
        }
      }, delay)
    }
  })

  state.tunnel = tunnel
  log.info(
    `[claude-fwd] Tunnel started: ${alias} -R ${TUNNEL_PORT}:127.0.0.1:${serverPort}`,
  )
}

/**
 * Shut down all tunnels (called on server shutdown).
 */
export function shutdownAllTunnels(): void {
  shuttingDown = true
  for (const [stableId, state] of hostStates) {
    if (state.tunnel) {
      log.info(`[claude-fwd] Killing tunnel to ${state.alias} (${stableId})`)
      state.tunnel.kill('SIGTERM')
      state.tunnel = null
    }
  }
  hostStates.clear()
}
