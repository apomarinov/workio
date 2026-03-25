import { getTerminalById } from '@domains/workspace/db/terminals'
import { execFileAsync } from '@server/lib/exec'
import { log } from '@server/logger'
import { execSSHCommand } from '@server/ssh/exec'

// ── Repo detection ───────────────────────────────────────────────────

const repoCache = new Map<string, { owner: string; repo: string } | null>()

function parseGitHubRemoteUrl(url: string) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (match) return { owner: match[1], repo: match[2] }
  return null
}

/**
 * Detect the GitHub owner/repo for a git working directory.
 * Results are cached per cwd (or sshHost:cwd for remote).
 *
 * Pass `fallbackUsername` to construct owner/folderName when
 * the git remote doesn't point to GitHub.
 */
export async function detectGitHubRepo(
  cwd: string,
  sshHost?: string | null,
  fallbackUsername?: string | null,
): Promise<{ owner: string; repo: string } | null> {
  const cacheKey = sshHost ? `${sshHost}:${cwd}` : cwd

  if (repoCache.has(cacheKey)) {
    return repoCache.get(cacheKey)!
  }

  try {
    let stdout: string

    if (sshHost) {
      const result = await execSSHCommand(
        sshHost,
        'git remote get-url origin',
        cwd,
      )
      stdout = result.stdout
    } else {
      const result = await execFileAsync(
        'git',
        ['remote', 'get-url', 'origin'],
        { cwd, timeout: 5000 },
      )
      stdout = result.stdout
    }

    const parsed = parseGitHubRemoteUrl(stdout.trim())
    if (parsed) {
      repoCache.set(cacheKey, parsed)
      return parsed
    }
  } catch (err) {
    if (sshHost) {
      log.error(
        { err },
        `[git] Failed to detect repo via SSH (${sshHost}:${cwd})`,
      )
    }
  }

  // Fallback: use username + folder name
  if (fallbackUsername) {
    const folderName = cwd.split('/').filter(Boolean).pop()
    if (folderName) {
      const result = { owner: fallbackUsername, repo: folderName }
      repoCache.set(cacheKey, result)
      return result
    }
  }

  repoCache.set(cacheKey, null)
  return null
}

// ── Terminal resolution ──────────────────────────────────────────────

export async function resolveGitTerminal(terminalId: number) {
  const terminal = await getTerminalById(terminalId)
  if (!terminal) {
    throw new Error('Terminal not found')
  }
  if (!terminal.git_repo) {
    throw new Error('Not a git repository')
  }
  return terminal as typeof terminal & {
    git_repo: NonNullable<(typeof terminal)['git_repo']>
  }
}
