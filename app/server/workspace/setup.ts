import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { deleteTerminal, getTerminalById, updateTerminal } from '../db'
import { getIO } from '../io'
import { log } from '../logger'

const execFile = promisify(execFileCb)

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

function readConductorJson(cwd: string): ConductorJson | null {
  const filePath = path.join(cwd, 'conductor.json')
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

export function emitWorkspace(
  terminalId: number,
  payload: Record<string, unknown>,
): void {
  getIO()?.emit('terminal:workspace', { terminalId, ...payload })
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

function resolveScripts(
  setupObj: SetupObj | null,
  cwd: string,
): ResolvedScripts {
  let setupScript: string | null = null
  let deleteScript: string | null = null

  if (setupObj?.conductor) {
    const config = readConductorJson(cwd)
    if (config) {
      const setup = config.scripts?.setup ?? config.setup
      const archive = config.scripts?.archive ?? config.archive
      if (setup) setupScript = path.resolve(cwd, setup)
      if (archive) deleteScript = path.resolve(cwd, archive)
    }
  }

  // Custom scripts override conductor paths (or work standalone)
  if (setupObj?.setup) setupScript = path.resolve(cwd, setupObj.setup)
  if (setupObj?.delete) deleteScript = path.resolve(cwd, setupObj.delete)

  return { setupScript, deleteScript }
}

async function runScript(scriptPath: string, cwd: string): Promise<void> {
  await execFile('bash', [scriptPath], { cwd })
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
}

export async function setupTerminalWorkspace(
  options: SetupOptions,
): Promise<void> {
  const { terminalId, repo, setupObj, workspacesRoot, worktreeSource } = options
  const slug = generateSlug()

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
      const parentDir = path.dirname(worktreeSource)
      targetPath = path.join(parentDir, slug)
      await execFile(
        'git',
        ['worktree', 'add', targetPath, '-b', `feature/${slug}`],
        { cwd: worktreeSource },
      )
    } else {
      // --- Clone mode (shallow) ---
      const base = workspacesRoot
        ? path.resolve(workspacesRoot.replace(/^~/, os.homedir()))
        : path.join(os.homedir(), 'repo-workspaces')
      targetPath = path.join(base, repoSlug(repo), slug)
      fs.mkdirSync(targetPath, { recursive: true })
      await execFile('git', [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        cloneUrl(repo),
        targetPath,
      ])
    }

    // Update terminal cwd to the target
    await updateTerminal(terminalId, { cwd: targetPath })

    // Get GitHub username and rename branch
    try {
      const { stdout } = await execFile('gh', ['api', 'user', '-q', '.login'])
      const ghUser = stdout.trim()
      if (ghUser) {
        if (worktreeSource) {
          // Rename the feature/slug branch to ghUser/slug
          await execFile(
            'git',
            ['branch', '-m', `feature/${slug}`, `${ghUser}/${slug}`],
            { cwd: targetPath },
          )
        } else {
          await execFile('git', ['checkout', '-b', `${ghUser}/${slug}`], {
            cwd: targetPath,
          })
        }
      }
    } catch (err) {
      log.warn(
        `[workspace] Could not create branch via gh CLI: ${err instanceof Error ? err.message : err}`,
      )
    }

    // Mark git_repo as done
    await updateTerminal(terminalId, { git_repo: gitRepoObj })
    emitWorkspace(terminalId, { git_repo: gitRepoObj })

    // Run setup script if configured
    if (setupObj) {
      const { setupScript } = resolveScripts(setupObj, targetPath)
      if (setupScript) {
        await runScript(setupScript, targetPath)
      }
      const doneSetup = { ...setupObj, status: 'done' as const }
      await updateTerminal(terminalId, { setup: doneSetup })
      emitWorkspace(terminalId, { setup: doneSetup })
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
      emitWorkspace(terminalId, { git_repo: failed })
    } else if (setupObj) {
      const failedSetup = {
        ...setupObj,
        status: 'failed' as const,
        error: errorMsg,
      }
      await updateTerminal(terminalId, { setup: failedSetup })
      emitWorkspace(terminalId, { setup: failedSetup })
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

  try {
    // Run delete script if configured
    const { deleteScript } = resolveScripts(
      terminal.setup as SetupObj | null,
      terminal.cwd,
    )
    if (deleteScript) {
      await runScript(deleteScript, terminal.cwd)
    }

    // Remove workspace directory
    fs.rmSync(terminal.cwd, { recursive: true, force: true })

    // Delete terminal from DB
    await deleteTerminal(terminalId)

    // Notify clients
    emitWorkspace(terminalId, { deleted: true })
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
    emitWorkspace(terminalId, { setup: failedSetup })
  }
}
