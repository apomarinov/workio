import { execFile as execFileCb } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  deleteTerminal,
  getTerminalById,
  insertNotification,
  logCommand,
  updateTerminal,
} from '../db'
import { getIO } from '../io'
import { log } from '../logger'
import {
  destroySession,
  getSession,
  interruptSession,
  waitForMarker,
  waitForSession,
  writeToSession,
} from '../pty/manager'
import { execSSHCommand } from '../ssh/exec'

const execFile = promisify(execFileCb)
const LONG_TIMEOUT = 300_000 // 5 min for clone/setup operations

// ---------------------------------------------------------------------------
// Word lists for slug generation (~100 each, no external packages)
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  'aged',
  'ancient',
  'autumn',
  'bold',
  'brave',
  'bright',
  'broad',
  'calm',
  'cold',
  'cool',
  'crimson',
  'curly',
  'damp',
  'dark',
  'dawn',
  'deep',
  'divine',
  'dry',
  'dusk',
  'early',
  'empty',
  'fading',
  'falling',
  'flat',
  'floral',
  'fragrant',
  'frosty',
  'gentle',
  'golden',
  'green',
  'hidden',
  'holy',
  'icy',
  'jolly',
  'late',
  'light',
  'lively',
  'long',
  'lucky',
  'misty',
  'morning',
  'muddy',
  'nameless',
  'noisy',
  'odd',
  'old',
  'orange',
  'patient',
  'plain',
  'polished',
  'proud',
  'purple',
  'quiet',
  'rapid',
  'raspy',
  'red',
  'restless',
  'rough',
  'round',
  'royal',
  'rustic',
  'shiny',
  'shy',
  'silent',
  'small',
  'snowy',
  'soft',
  'solitary',
  'sparkling',
  'spring',
  'still',
  'summer',
  'swift',
  'tall',
  'tender',
  'thirsty',
  'tight',
  'tiny',
  'jesus',
  'twilight',
  'wandering',
  'warm',
  'weathered',
  'white',
  'wild',
  'winter',
  'wispy',
  'withered',
  'young',
]

const NOUNS = [
  'bird',
  'bloom',
  'boulder',
  'breeze',
  'brook',
  'bush',
  'butterfly',
  'canyon',
  'cave',
  'cherry',
  'cliff',
  'cloud',
  'coral',
  'creek',
  'dawn',
  'dew',
  'dream',
  'dust',
  'falcon',
  'feather',
  'field',
  'fire',
  'flower',
  'fog',
  'forest',
  'frog',
  'frost',
  'glade',
  'grass',
  'haze',
  'christ',
  'hill',
  'lake',
  'leaf',
  'lily',
  'maple',
  'meadow',
  'mist',
  'moon',
  'moss',
  'mountain',
  'night',
  'oak',
  'ocean',
  'paper',
  'path',
  'peak',
  'pebble',
  'penguin',
  'pine',
  'plain',
  'pond',
  'rain',
  'reed',
  'ridge',
  'river',
  'rock',
  'rose',
  'sage',
  'sea',
  'shadow',
  'shore',
  'silence',
  'sky',
  'smoke',
  'snow',
  'sound',
  'sparrow',
  'spring',
  'star',
  'stone',
  'storm',
  'stream',
  'sun',
  'sunset',
  'surf',
  'thunder',
  'tree',
  'valley',
  'violet',
  'voice',
  'water',
  'waterfall',
  'wave',
  'wildflower',
  'wind',
  'wood',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}

function repoSlug(repo: string): string {
  return repo.split('/').pop()!
}

function cloneUrl(repo: string): string {
  return `git@github.com:${repo}.git`
}

export async function emitWorkspace(
  terminalId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const io = getIO()

  // Always emit terminal:workspace for client state updates
  io?.emit('terminal:workspace', { terminalId, ...payload })

  // Determine notification type based on payload state
  let notificationType: string | null = null
  if (payload.deleted) {
    notificationType = 'workspace_deleted'
  } else if (
    payload.setup &&
    typeof payload.setup === 'object' &&
    'status' in payload.setup
  ) {
    const setup = payload.setup as { status: string }
    if (setup.status === 'done') {
      notificationType = 'workspace_ready'
    } else if (setup.status === 'failed') {
      notificationType = 'workspace_failed'
    }
  } else if (
    payload.git_repo &&
    typeof payload.git_repo === 'object' &&
    'status' in payload.git_repo
  ) {
    const gitRepo = payload.git_repo as { status: string }
    if (gitRepo.status === 'failed') {
      notificationType = 'workspace_repo_failed'
    }
  }

  // Additionally insert notification for terminal states that need it
  if (notificationType) {
    const notification = await insertNotification(
      notificationType,
      'workspace', // Use 'workspace' as repo for workspace notifications
      { terminalId, ...payload },
      `${terminalId}:${notificationType}`, // Dedup by terminalId + type
    )
    if (notification) {
      io?.emit('notifications:new', notification)
    }
  }
}

// ---------------------------------------------------------------------------
// SSH-aware filesystem helpers
// ---------------------------------------------------------------------------

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function joinPath(sshHost: string | null, ...segments: string[]): string {
  if (!sshHost) return path.join(...segments)
  // POSIX join: filter empty, join with /
  return segments
    .flatMap((s) => s.split('/'))
    .filter(Boolean)
    .join('/')
    .replace(/^(?!\/)/, () => (segments[0]?.startsWith('/') ? '/' : ''))
}

function dirnamePath(sshHost: string | null, p: string): string {
  if (!sshHost) return path.dirname(p)
  const idx = p.lastIndexOf('/')
  if (idx <= 0) return '/'
  return p.slice(0, idx)
}

function resolvePath(
  sshHost: string | null,
  base: string,
  rel: string,
): string {
  if (!sshHost) return path.resolve(base, rel)
  if (rel.startsWith('/')) return rel
  return `${base.replace(/\/+$/, '')}/${rel}`
}

async function getHomeDir(sshHost: string | null): Promise<string> {
  if (!sshHost) return os.homedir()
  const { stdout } = await execSSHCommand(sshHost, 'echo $HOME')
  return stdout.trim()
}

async function dirExists(
  dirPath: string,
  sshHost: string | null,
): Promise<boolean> {
  if (!sshHost) return fs.existsSync(dirPath)
  try {
    await execSSHCommand(sshHost, `test -d ${shellQuote(dirPath)}`)
    return true
  } catch {
    return false
  }
}

async function mkdirp(dirPath: string, sshHost: string | null): Promise<void> {
  if (!sshHost) {
    fs.mkdirSync(dirPath, { recursive: true })
    return
  }
  await execSSHCommand(sshHost, `mkdir -p ${shellQuote(dirPath)}`)
}

export async function rmrf(
  dirPath: string,
  sshHost: string | null,
): Promise<void> {
  if (!sshHost) {
    fs.rmSync(dirPath, { recursive: true, force: true })
    return
  }
  await execSSHCommand(sshHost, `rm -rf ${shellQuote(dirPath)}`)
}

async function readFileContent(
  filePath: string,
  sshHost: string | null,
): Promise<string | null> {
  if (!sshHost) {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  }
  try {
    const { stdout } = await execSSHCommand(
      sshHost,
      `cat ${shellQuote(filePath)}`,
    )
    return stdout
  } catch {
    return null
  }
}

async function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  sshHost: string | null,
  timeout?: number,
): Promise<{ stdout: string; stderr: string }> {
  if (!sshHost) {
    return execFile(cmd, args, { cwd, timeout })
  }
  const quoted = [cmd, ...args].map(shellQuote).join(' ')
  return execSSHCommand(sshHost, quoted, { cwd, timeout })
}

// ---------------------------------------------------------------------------
// Conductor JSON reading
// ---------------------------------------------------------------------------

interface ConductorJson {
  setup?: string
  archive?: string
  run?: string
  runScriptMode?: string
  scripts?: {
    setup?: string
    archive?: string
    run?: string
  }
}

async function readConductorJson(
  cwd: string,
  sshHost: string | null,
): Promise<ConductorJson | null> {
  const filePath = sshHost
    ? `${cwd.replace(/\/+$/, '')}/conductor.json`
    : path.join(cwd, 'conductor.json')
  const content = await readFileContent(filePath, sshHost)
  if (content == null) return null
  return JSON.parse(content)
}

// ---------------------------------------------------------------------------
// Script resolution and execution
// ---------------------------------------------------------------------------

interface SetupObj {
  conductor?: boolean
  setup?: string
  delete?: string
}

interface ResolvedScripts {
  setupScript: string | null
  deleteScript: string | null
}

async function resolveScripts(
  setupObj: SetupObj | null,
  cwd: string,
  sshHost: string | null,
): Promise<ResolvedScripts> {
  let setupScript: string | null = null
  let deleteScript: string | null = null

  if (setupObj?.conductor) {
    const config = await readConductorJson(cwd, sshHost)
    if (config) {
      const setup = config.scripts?.setup ?? config.setup
      const archive = config.scripts?.archive ?? config.archive
      if (setup) setupScript = resolvePath(sshHost, cwd, setup)
      if (archive) deleteScript = resolvePath(sshHost, cwd, archive)
    }
  }

  // Custom scripts override conductor paths (or work standalone)
  if (setupObj?.setup) setupScript = resolvePath(sshHost, cwd, setupObj.setup)
  if (setupObj?.delete)
    deleteScript = resolvePath(sshHost, cwd, setupObj.delete)

  return { setupScript, deleteScript }
}

// ---------------------------------------------------------------------------
// Setup workspace (fire-and-forget from route handler)
// ---------------------------------------------------------------------------

export interface SetupOptions {
  terminalId: number
  repo: string
  setupObj: SetupObj | null
  workspacesRoot?: string
  worktreeSource?: string // if set, use git worktree instead of clone
  customName?: boolean // if true, don't override the terminal name with repo/slug
  sshHost?: string | null
}

export async function setupTerminalWorkspace(
  options: SetupOptions,
): Promise<void> {
  const {
    terminalId,
    repo,
    setupObj,
    workspacesRoot,
    worktreeSource,
    customName,
    sshHost = null,
  } = options

  const homeDir = await getHomeDir(sshHost)

  // Generate a slug whose target directory doesn't already exist
  const parentDir = worktreeSource
    ? dirnamePath(sshHost, worktreeSource)
    : joinPath(
        sshHost,
        workspacesRoot
          ? resolvePath(sshHost, homeDir, workspacesRoot.replace(/^~\/?/, ''))
          : joinPath(sshHost, homeDir, 'repo-workspaces'),
        repoSlug(repo),
      )
  let slug = generateSlug()
  let attempts = 0
  while (await dirExists(joinPath(sshHost, parentDir, slug), sshHost)) {
    attempts++
    if (attempts >= 10) {
      slug = crypto.randomUUID().slice(0, 8)
      break
    }
    slug = generateSlug()
  }
  const terminalName = `${repoSlug(repo)}/${slug}`

  const gitRepoObj = workspacesRoot
    ? { repo, status: 'done' as const, workspaces_root: workspacesRoot }
    : { repo, status: 'done' as const }
  const gitRepoFailed = (error: string) =>
    workspacesRoot
      ? {
          repo,
          status: 'failed' as const,
          workspaces_root: workspacesRoot,
          error,
        }
      : { repo, status: 'failed' as const, error }

  try {
    let targetPath: string

    if (worktreeSource) {
      // --- Worktree mode ---
      // First prune any orphaned worktrees from previous deletions
      const pruneCmd = 'git worktree prune'
      try {
        const pruneResult = await runCmd(
          'git',
          ['worktree', 'prune'],
          worktreeSource,
          sshHost,
          10000,
        )
        logCommand({
          terminalId,
          category: 'workspace',
          command: pruneCmd,
          stdout: pruneResult.stdout,
          stderr: pruneResult.stderr,
        })
      } catch {
        // Ignore prune errors
      }

      targetPath = joinPath(sshHost, parentDir, slug)
      const worktreeCmd = `git worktree add ${targetPath} -b feature/${slug}`
      const worktreeResult = await runCmd(
        'git',
        ['worktree', 'add', targetPath, '-b', `feature/${slug}`],
        worktreeSource,
        sshHost,
        LONG_TIMEOUT,
      )
      logCommand({
        terminalId,
        category: 'workspace',
        command: worktreeCmd,
        stdout: worktreeResult.stdout,
        stderr: worktreeResult.stderr,
      })
    } else {
      // --- Clone mode (shallow) ---
      targetPath = joinPath(sshHost, parentDir, slug)
      await mkdirp(targetPath, sshHost)
      const cloneCmd = `git clone --depth 1 --single-branch ${cloneUrl(repo)} ${targetPath}`
      const cloneResult = await runCmd(
        'git',
        [
          'clone',
          '--depth',
          '1',
          '--single-branch',
          cloneUrl(repo),
          targetPath,
        ],
        sshHost ? '/' : process.cwd(),
        sshHost,
        LONG_TIMEOUT,
      )
      logCommand({
        terminalId,
        category: 'workspace',
        command: cloneCmd,
        stdout: cloneResult.stdout,
        stderr: cloneResult.stderr,
      })
    }

    // Update terminal cwd (and name if not user-provided)
    if (customName) {
      await updateTerminal(terminalId, { cwd: targetPath })
    } else {
      await updateTerminal(terminalId, { cwd: targetPath, name: terminalName })
    }
    await emitWorkspace(terminalId, { name: terminalName })

    // Get GitHub username and rename branch
    // gh api runs locally (GitHub API call, gh CLI unlikely on remote)
    try {
      const { stdout } = await execFile('gh', ['api', 'user', '-q', '.login'])
      const ghUser = stdout.trim()
      if (ghUser) {
        if (worktreeSource) {
          // Rename the feature/slug branch to ghUser/slug
          await runCmd(
            'git',
            ['branch', '-m', `feature/${slug}`, `${ghUser}/${slug}`],
            targetPath,
            sshHost,
          )
        } else {
          await runCmd(
            'git',
            ['checkout', '-b', `${ghUser}/${slug}`],
            targetPath,
            sshHost,
          )
        }
      }
    } catch (err) {
      log.warn(
        `[workspace] Could not create branch via gh CLI: ${err instanceof Error ? err.message : err}`,
      )
    }

    // Mark git_repo as done
    await updateTerminal(terminalId, { git_repo: gitRepoObj })
    await emitWorkspace(terminalId, {
      name: terminalName,
      git_repo: gitRepoObj,
    })

    // Run setup script if configured — inject into PTY so output is visible
    if (setupObj) {
      const { setupScript } = await resolveScripts(
        setupObj,
        targetPath,
        sshHost,
      )
      if (setupScript) {
        const setupCmd = `bash "${setupScript}"`
        const hasSession = await waitForSession(terminalId, 30_000)
        if (hasSession) {
          writeToSession(
            terminalId,
            `cd "${targetPath}" && bash "${setupScript}"; printf '\\e]133;Z;%d\\e\\\\' $?\n`,
          )
          const exitCode = await waitForMarker(terminalId)
          logCommand({
            terminalId,
            category: 'workspace',
            command: setupCmd,
            stderr: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
            failed: exitCode !== 0,
          })
          if (exitCode !== 0) {
            throw new Error(`Setup script exited with code ${exitCode}`)
          }
        }
      }
      const doneSetup = { ...setupObj, status: 'done' as const }
      await updateTerminal(terminalId, { setup: doneSetup })
      await emitWorkspace(terminalId, { name: terminalName, setup: doneSetup })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    log.error(
      `[workspace] Setup failed for terminal ${terminalId}: ${errorMsg}`,
    )

    const terminal = await getTerminalById(terminalId)
    if (terminal?.git_repo?.status === 'setup') {
      const failed = gitRepoFailed(errorMsg)
      await updateTerminal(terminalId, { git_repo: failed })
      await emitWorkspace(terminalId, { name: terminalName, git_repo: failed })
    } else if (setupObj) {
      const failedSetup = {
        ...setupObj,
        status: 'failed' as const,
        error: errorMsg,
      }
      await updateTerminal(terminalId, { setup: failedSetup })
      await emitWorkspace(terminalId, {
        name: terminalName,
        setup: failedSetup,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Delete workspace (fire-and-forget from delete route handler)
// ---------------------------------------------------------------------------

export async function deleteTerminalWorkspace(
  terminalId: number,
): Promise<void> {
  const terminal = await getTerminalById(terminalId)
  if (!terminal) return

  const sshHost = terminal.ssh_host ?? null

  try {
    // Run delete script if configured — inject into PTY so output is visible
    const { deleteScript } = await resolveScripts(
      terminal.setup as SetupObj | null,
      terminal.cwd,
      sshHost,
    )
    if (deleteScript) {
      const deleteCmd = `bash "${deleteScript}"`
      const session = getSession(terminalId)
      if (session) {
        interruptSession(terminalId)
        await new Promise((r) => setTimeout(r, 300))
        writeToSession(
          terminalId,
          `cd "${terminal.cwd}" && bash "${deleteScript}"; printf '\\e]133;Z;%d\\e\\\\' $?\n`,
        )
        const exitCode = await waitForMarker(terminalId)
        logCommand({
          terminalId,
          category: 'workspace',
          command: deleteCmd,
          stderr: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
          failed: exitCode !== 0,
        })
        if (exitCode !== 0) {
          throw new Error(`Teardown script exited with code ${exitCode}`)
        }
      }
    }

    // Cleanup: destroy session, remove files, delete from DB
    destroySession(terminalId)
    const rmCmd = `rm -rf ${terminal.cwd}`
    await rmrf(terminal.cwd, sshHost)
    logCommand({
      terminalId,
      category: 'workspace',
      command: rmCmd,
    })
    await deleteTerminal(terminalId)

    // Notify clients
    await emitWorkspace(terminalId, { name: terminal.name, deleted: true })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    log.error(
      `[workspace] Delete failed for terminal ${terminalId}: ${errorMsg}`,
    )

    const failedSetup = {
      ...(terminal.setup as SetupObj | null),
      status: 'failed' as const,
      error: errorMsg,
    }
    await updateTerminal(terminalId, { setup: failedSetup })
    await emitWorkspace(terminalId, { name: terminal.name, setup: failedSetup })
  }
}
