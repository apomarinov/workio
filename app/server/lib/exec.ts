import { execFile as execFileNode } from 'node:child_process'
import { promisify } from 'node:util'
import { logCommand } from '@domains/logs/db'
import { resolveTool } from '@server/lib/tool-paths'
import { updateGithubGraphql, updateGithubRest } from '@server/status'

const execFileAsyncRaw = promisify(execFileNode)

// Resolve bare command names to absolute paths before spawning so
// execFile doesn't trigger a kernel-level $PATH walk on every call
// (see KERNEL_PANIC_INVESTIGATION.md). Use these wrappers instead of
// importing from 'node:child_process' for anything that runs in a poll
// loop.
export const execFileAsync = ((file: string, ...rest: unknown[]) =>
  // biome-ignore lint/suspicious/noExplicitAny: forward all overloads of promisified execFile
  (execFileAsyncRaw as any)(
    resolveTool(file),
    ...rest,
  )) as typeof execFileAsyncRaw

export const execFile = ((file: string, ...rest: unknown[]) =>
  // biome-ignore lint/suspicious/noExplicitAny: forward all overloads of execFile
  (execFileNode as any)(resolveTool(file), ...rest)) as typeof execFileNode

/** Extract stderr from an execFile rejection error. */
export function getExecStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    return String((err as { stderr: unknown }).stderr)
  }
  return ''
}

/**
 * Build a human-readable failure description for a rejected execFile error.
 * Prefers stderr, then falls back to `<message> (exit <code>[, signal <signal>])`
 * so we don't end up logging the bare "Command failed: ..." message with no
 * diagnostic info when the child exits non-zero without writing stderr.
 */
export function getExecFailure(err: unknown): string {
  const stderrText = getExecStderr(err)
  if (stderrText) return stderrText
  const message = err instanceof Error ? err.message : String(err)
  const obj = (err && typeof err === 'object' ? err : {}) as Record<
    string,
    unknown
  >
  const code = obj.code
  const signal = obj.signal
  const parts: string[] = []
  if (code !== undefined && code !== null) parts.push(`exit ${String(code)}`)
  if (signal) parts.push(`signal ${String(signal)}`)
  return parts.length > 0 ? `${message} (${parts.join(', ')})` : message
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
    const failure = getExecFailure(err)
    logCommand({
      terminalId,
      prId,
      category,
      service,
      command,
      stderr: failure,
      failed: true,
      dedupeKey,
    })
    // Update service health status on github API failures
    if (service === 'github-rest') {
      updateGithubRest({
        status: 'error',
        error: failure.substring(0, 200),
      })
    } else if (service === 'github-graphql') {
      updateGithubGraphql({
        status: 'error',
        error: failure.substring(0, 200),
      })
    }
    throw new Error(failure)
  }
}
