import { getTerminalById } from '@domains/workspace/db/terminals'
import { execFileAsync } from '@server/lib/exec'
import { execSSHCommand } from '@server/ssh/exec'

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

/**
 * Detects the current git branch for a terminal (local or SSH).
 * Returns the branch name and repo, or null if detection fails.
 */
export async function detectBranch(
  terminalId: number | null,
  projectPath: string,
): Promise<{ branch: string; repo: string } | null> {
  const terminal = terminalId ? await getTerminalById(terminalId) : null
  let branch: string

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

  if (!branch) return null

  const repo = terminal?.git_repo?.repo ?? ''
  return { branch, repo }
}
