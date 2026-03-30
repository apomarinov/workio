import fs from 'node:fs'
import path from 'node:path'
import { clearRepoCache, detectGitHubRepo } from '@domains/git/services/resolve'
import { detectGitBranch } from '@domains/git/services/status'
import {
  getTerminalById,
  updateTerminal,
} from '@domains/workspace/db/terminals'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { execFileAsyncLogged } from '@server/lib/exec'
import { log } from '@server/logger'
import { execSSHCommandLogged } from '@server/ssh/exec'

/**
 * Auto-detect git repo, conductor.json, and branch for a terminal.
 * Called on terminal creation (directly) and session creation (via event).
 */
export async function autoDetectTerminal(
  terminalId: number,
  options?: { refreshPRChecks?: boolean },
) {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal) return

    // Detect / re-detect git repo (skip if already has owner/repo format)
    if (!terminal.git_repo || !terminal.git_repo.repo.includes('/'))
      try {
        clearRepoCache(terminal.cwd, terminal.ssh_host)
        const repo = await detectGitHubRepo(terminal.cwd, terminal.ssh_host)
        let repoName: string | null = null
        if (repo) {
          repoName = `${repo.owner}/${repo.repo}`
        } else if (!terminal.git_repo) {
          // No GitHub remote — check if the directory is a git repo
          try {
            if (terminal.ssh_host) {
              await execSSHCommandLogged(
                terminal.ssh_host,
                'git rev-parse --git-dir',
                { cwd: terminal.cwd, category: 'git', errorOnly: true },
              )
            } else {
              await execFileAsyncLogged('git', ['rev-parse', '--git-dir'], {
                cwd: terminal.cwd,
                timeout: 5000,
                category: 'git',
                errorOnly: true,
              })
            }
            // It's a git repo — use folder name as repo identifier
            repoName = path.basename(terminal.cwd)
          } catch {
            // Not a git repo, leave git_repo null
          }
        }
        if (repoName && repoName !== terminal.git_repo?.repo) {
          const gitRepoObj = {
            repo: repoName,
            status: 'done' as const,
          }
          await updateTerminal(terminalId, { git_repo: gitRepoObj })
          getIO()?.emit('terminal:workspace', {
            terminalId,
            name: terminal.name || terminal.cwd,
            git_repo: gitRepoObj,
          })
        }
      } catch (err) {
        log.error({ err, terminalId }, '[workspace] Failed to detect git repo')
      }

    // Detect conductor.json if no setup configured
    if (!terminal.setup) {
      try {
        let hasConductor = false
        if (terminal.ssh_host) {
          const conductorPath = `${terminal.cwd.replace(/\/+$/, '')}/conductor.json`
          const result = await execSSHCommandLogged(
            terminal.ssh_host,
            `test -f "${conductorPath}" && echo "yes"`,
            { cwd: terminal.cwd, category: 'workspace', errorOnly: true },
          )
          hasConductor = result.stdout.trim() === 'yes'
        } else {
          hasConductor = fs.existsSync(`${terminal.cwd}/conductor.json`)
        }

        if (hasConductor) {
          const setupObj = { conductor: true, status: 'done' as const }
          await updateTerminal(terminalId, { setup: setupObj })
          getIO()?.emit('terminal:workspace', {
            terminalId,
            name: terminal.name || terminal.cwd,
            setup: setupObj,
          })
        }
      } catch (err) {
        log.error(
          { err, terminalId },
          '[workspace] Failed to detect conductor.json',
        )
      }
    }

    // Detect branch for SSH terminals that don't have one yet
    if (terminal.ssh_host && !terminal.git_branch) {
      detectGitBranch(terminalId, { skipPRRefresh: true })
    }

    if (options?.refreshPRChecks) {
      serverEvents.emit('github:refresh-pr-checks')
    }
  } catch (err) {
    log.error({ err, terminalId }, '[workspace] Failed to auto-detect terminal')
  }
}

// Re-run auto-detect when a PTY session connects (covers terminals
// that existed before the server started or where detection failed initially)
serverEvents.on('pty:session-created', ({ terminalId }) => {
  autoDetectTerminal(terminalId)
})
