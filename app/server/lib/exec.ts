import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logCommand } from '@domains/logs/db'

export const execFileAsync = promisify(execFile)

/** Extract stderr from an execFile rejection error. */
export function getExecStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    return String((err as { stderr: unknown }).stderr)
  }
  return ''
}

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
    ...execOpts
  } = opts
  const command = logCmd ?? `${cmd} ${args.join(' ')}`
  try {
    const result = await execFileAsync(cmd, args, execOpts)
    if (!errorOnly) {
      logCommand({
        terminalId,
        prId,
        category,
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
      command,
      stderr: stderr || message,
      failed: true,
      dedupeKey,
    })
    throw new Error(stderr || message)
  }
}
