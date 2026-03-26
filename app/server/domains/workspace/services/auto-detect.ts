import fs from 'node:fs'
import { detectGitHubRepo } from '@domains/git/services/resolve'
import { detectGitBranch } from '@domains/git/services/status'
import {
  getTerminalById,
  updateTerminal,
} from '@domains/workspace/db/terminals'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { log } from '@server/logger'
import { execSSHCommand } from '@server/ssh/exec'

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

    // Detect git repo if not already set
    if (!terminal.git_repo) {
      try {
        const repo = await detectGitHubRepo(terminal.cwd, terminal.ssh_host)
        if (repo) {
          const gitRepoObj = {
            repo: `${repo.owner}/${repo.repo}`,
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
    }

    // Detect conductor.json if no setup configured
    if (!terminal.setup) {
      try {
        let hasConductor = false
        if (terminal.ssh_host) {
          const conductorPath = `${terminal.cwd.replace(/\/+$/, '')}/conductor.json`
          const result = await execSSHCommand(
            terminal.ssh_host,
            `test -f "${conductorPath}" && echo "yes"`,
            terminal.cwd,
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
