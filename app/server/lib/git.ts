import os from 'node:os'
import path from 'node:path'
import { logCommand } from '../db'
import { execSSHCommand } from '../ssh/exec'
import { execFileAsync } from './exec'

/** Shell-escape a string for safe embedding in SSH commands. */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Expand ~ to home directory. */
export function expandPath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  if (p === '~') return os.homedir()
  return p
}

export interface GitTerminal {
  ssh_host: string | null
  cwd: string
}

interface GitExecOpts {
  timeout?: number
  env?: Record<string, string>
  maxBuffer?: number
  /** Override SSH command when shell features (||, 2>/dev/null) are needed. */
  sshCmd?: string
}

/**
 * Run a git command on a terminal (local or SSH).
 * For SSH, constructs a shell command from args (or uses sshCmd override).
 * For local, uses execFile with args array (no shell invocation).
 */
export function gitExec(
  terminal: GitTerminal,
  args: string[],
  opts?: GitExecOpts,
): Promise<{ stdout: string; stderr: string }> {
  const timeout = opts?.timeout ?? 30000

  if (terminal.ssh_host) {
    const cmd = opts?.sshCmd ?? `git ${args.map(shellEscape).join(' ')}`
    const fullCmd = opts?.env
      ? `${Object.entries(opts.env)
          .map(([k, v]) => `${k}=${shellEscape(v)}`)
          .join(' ')} ${cmd}`
      : cmd
    return execSSHCommand(terminal.ssh_host, fullCmd, {
      cwd: terminal.cwd,
      timeout,
    })
  }

  return execFileAsync('git', args, {
    cwd: expandPath(terminal.cwd),
    timeout,
    ...(opts?.env && { env: { ...process.env, ...opts.env } }),
    ...(opts?.maxBuffer && { maxBuffer: opts.maxBuffer }),
  })
}

interface GitExecLoggedOpts extends GitExecOpts {
  terminalId: number
  /** Override the command string used for logging. Defaults to `git ${args.join(' ')}`. */
  logCmd?: string
}

/**
 * Run a git command and log it via logCommand().
 * On error, the command is logged as failed before the error propagates.
 */
export async function gitExecLogged(
  terminal: GitTerminal,
  args: string[],
  opts: GitExecLoggedOpts,
): Promise<{ stdout: string; stderr: string }> {
  const command = opts.logCmd ?? `git ${args.join(' ')}`
  try {
    const result = await gitExec(terminal, args, opts)
    logCommand({
      terminalId: opts.terminalId,
      category: 'git',
      command,
      stdout: result.stdout,
      stderr: result.stderr,
    })
    return result
  } catch (err) {
    logCommand({
      terminalId: opts.terminalId,
      category: 'git',
      command,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      failed: true,
    })
    throw err
  }
}
