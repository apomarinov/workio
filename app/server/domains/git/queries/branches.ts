import { type BranchInfo, terminalIdInput } from '@domains/git/schema'
import { resolveGitTerminal } from '@domains/git/services/resolve'
import { gitExec } from '@server/lib/git'
import { publicProcedure } from '@server/trpc'

export const list = publicProcedure
  .input(terminalIdInput)
  .query(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    const result = await gitExec(
      terminal,
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)|%(HEAD)|%(committerdate:iso8601)',
        'refs/heads',
        'refs/remotes/origin',
      ],
      { timeout: 10000 },
    )

    let currentBranch: BranchInfo | null = null
    const local: BranchInfo[] = []
    const remote: BranchInfo[] = []

    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const [name, head, commitDate] = line.split('|')

      if (name === 'origin/HEAD' || name === 'origin') continue

      const isCurrent = head === '*'

      if (name.startsWith('origin/')) {
        const branchName = name.slice(7)
        if (remote.length < 50) {
          remote.push({ name: branchName, current: false, commitDate })
        }
      } else {
        if (isCurrent) {
          currentBranch = { name, current: true, commitDate }
        } else if (local.length < 49) {
          local.push({ name, current: false, commitDate })
        }
      }
    }

    if (currentBranch) {
      local.unshift(currentBranch)
    }

    return { local, remote }
  })
