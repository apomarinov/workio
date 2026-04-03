import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logCommand } from '@domains/logs/db'
import { updateGithubGraphql, updateGithubRest } from '@server/status'

export const execFileAsync = promisify(execFile)

/** Extract stderr from an execFile rejection error. */
export function getExecStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    return String((err as { stderr: unknown }).stderr)
  }
  return ''
}

type GithubService = 'github-rest' | 'github-graphql' | 'github-webhooks'

interface ExecFileLoggedOptions {
  timeout?: number
  maxBuffer?: number
  cwd?: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  encoding?: BufferEncoding
  // Logging fields
  category: 'git' | 'workspace' | 'github'
  /** Override command string for logging. Defaults to `cmd args.join(' ')`. */
  logCmd?: string
  terminalId?: number
  prId?: string
  dedupeKey?: string
  /** When true, only log if the command fails (skip success logging). */
  errorOnly?: boolean
  /** Explicit service for logging. Auto-detected from args when category is 'github'. */
  service?: GithubService
}

/** Infer github service from gh CLI args. */
function inferGithubService(args: string[]): GithubService | undefined {
  if (args.includes('graphql')) return 'github-graphql'
  if (args[0] === 'api' || args.includes('api')) return 'github-rest'
  // gh pr view, gh pr comment, gh pr ready -> REST
  if (args[0] === 'pr') return 'github-rest'
  return undefined
}

/**
 * Run execFileAsync and log the result via logCommand().
 * On error, logs as failed and throws a clean Error (stderr or message).
 */
export async function execFileAsyncLogged(
  cmd: string,
  args: string[],
  opts: ExecFileLoggedOptions,
): Promise<{ stdout: string; stderr: string }> {
  const {
    category,
    logCmd,
    terminalId,
    prId,
    dedupeKey,
    errorOnly,
    service: explicitService,
    ...execOpts
  } = opts
  const command = logCmd ?? `${cmd} ${args.join(' ')}`
  const service =
    explicitService ??
    (category === 'github' ? inferGithubService(args) : undefined)
  try {
    const result = await execFileAsync(cmd, args, execOpts)
    if (!errorOnly) {
      logCommand({
        terminalId,
        prId,
        category,
        service,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        dedupeKey,
      })
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stderr = getExecStderr(err)
    logCommand({
      terminalId,
      prId,
      category,
      service,
      command,
      stderr: stderr || message,
      failed: true,
      dedupeKey,
    })
    // Update service health status on github API failures
    if (service === 'github-rest') {
      updateGithubRest({
        status: 'error',
        error: (stderr || message).substring(0, 200),
      })
    } else if (service === 'github-graphql') {
      updateGithubGraphql({
        status: 'error',
        error: (stderr || message).substring(0, 200),
      })
    }
    throw new Error(stderr || message)
  }
}
