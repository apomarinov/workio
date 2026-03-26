import { logCommand } from '@domains/logs/db'
import { type PoolExecSSHOptions, poolExecSSHCommand } from './pool'

export type ExecSSHOptions = PoolExecSSHOptions

export function execSSHCommand(
  sshHost: string,
  command: string,
  options?: string | ExecSSHOptions,
): Promise<{ stdout: string; stderr: string }> {
  return poolExecSSHCommand(sshHost, command, options)
}

interface ExecSSHLoggedOptions extends ExecSSHOptions {
  terminalId?: number
  category: 'git' | 'workspace' | 'github'
  /** Override the command string used for logging. Defaults to the actual command. */
  logCmd?: string
  dedupeKey?: string
  /** When true, only log if the command fails (skip success logging). */
  errorOnly?: boolean
}

/**
 * Run an SSH command and log it via logCommand().
 * On error, the command is logged as failed before the error propagates.
 */
export async function execSSHCommandLogged(
  sshHost: string,
  command: string,
  opts: ExecSSHLoggedOptions,
): Promise<{ stdout: string; stderr: string }> {
  const { terminalId, category, logCmd, dedupeKey, errorOnly, ...sshOpts } =
    opts
  const loggedCommand = logCmd ?? `ssh ${sshHost} -- ${command}`
  try {
    const result = await execSSHCommand(sshHost, command, sshOpts)
    if (!errorOnly) {
      logCommand({
        terminalId,
        category,
        command: loggedCommand,
        stdout: result.stdout,
        stderr: result.stderr,
        dedupeKey,
      })
    }
    return result
  } catch (err) {
    logCommand({
      terminalId,
      category,
      command: loggedCommand,
      stderr: err instanceof Error ? err.message : String(err),
      failed: true,
      dedupeKey,
    })
    throw err
  }
}
