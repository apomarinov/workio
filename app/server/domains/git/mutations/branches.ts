import {
  branchInput,
  createBranchInput,
  deleteBranchInput,
  pushInput,
  renameBranchInput,
  terminalIdInput,
} from '@domains/git/schema'
import { resolveGitTerminal } from '@domains/git/services/resolve'
import {
  checkAndEmitSingleGitDirty,
  detectGitBranch,
} from '@domains/git/services/status'
import { gitExecLogged } from '@server/lib/git'
import { log } from '@server/logger'
import { publicProcedure } from '@server/trpc'

export const fetchAllMutation = publicProcedure
  .input(terminalIdInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    await gitExecLogged(terminal, ['fetch', '--all'], {
      terminalId: input.terminalId,
      timeout: 30000,
    })
  })

export const checkoutMutation = publicProcedure
  .input(branchInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    // Prune stale worktrees before checkout
    await gitExecLogged(terminal, ['worktree', 'prune'], {
      terminalId: input.terminalId,
      errorOnly: true,
      timeout: 5000,
    }).catch((err) =>
      log.error(
        { err, terminalId: input.terminalId },
        '[git] Failed to prune worktrees',
      ),
    )

    await gitExecLogged(terminal, ['checkout', input.branch], {
      terminalId: input.terminalId,
      timeout: 30000,
    })

    detectGitBranch(input.terminalId)
    checkAndEmitSingleGitDirty(input.terminalId)
  })

export const pullMutation = publicProcedure
  .input(branchInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    const currentBranch = terminal.git_branch || ''
    const isOnTargetBranch = currentBranch === input.branch

    if (isOnTargetBranch) {
      await gitExecLogged(
        terminal,
        ['pull', '--rebase', 'origin', input.branch],
        { terminalId: input.terminalId, timeout: 60000 },
      )
    } else {
      await gitExecLogged(
        terminal,
        ['fetch', 'origin', `${input.branch}:${input.branch}`],
        { terminalId: input.terminalId, timeout: 60000 },
      )
    }

    detectGitBranch(input.terminalId)
    checkAndEmitSingleGitDirty(input.terminalId)
  })

export const pushMutation = publicProcedure
  .input(pushInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    const pushArgs = input.force
      ? ['push', '-u', '--force', 'origin', input.branch]
      : ['push', '-u', 'origin', input.branch]

    await gitExecLogged(terminal, pushArgs, {
      terminalId: input.terminalId,
      timeout: 60000,
    })

    // Update the local remote-tracking ref for single-branch clones
    gitExecLogged(
      terminal,
      ['update-ref', `refs/remotes/origin/${input.branch}`, 'HEAD'],
      { terminalId: input.terminalId, errorOnly: true, timeout: 5000 },
    ).catch(() => {})

    detectGitBranch(input.terminalId)
    checkAndEmitSingleGitDirty(input.terminalId)
  })

export const rebaseMutation = publicProcedure
  .input(branchInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    const currentBranch = terminal.git_branch
    if (!currentBranch) {
      throw new Error('Could not determine current branch')
    }
    if (input.branch === currentBranch) {
      throw new Error('Cannot rebase branch onto itself')
    }

    try {
      await gitExecLogged(terminal, ['rebase', input.branch], {
        terminalId: input.terminalId,
        timeout: 60000,
      })
    } catch (err) {
      await gitExecLogged(terminal, ['rebase', '--abort'], {
        terminalId: input.terminalId,
        timeout: 10000,
      }).catch(() => {})
      throw err
    }

    detectGitBranch(input.terminalId)

    return { branch: currentBranch, onto: input.branch }
  })

export const deleteBranchMutation = publicProcedure
  .input(deleteBranchInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    if (input.branch === terminal.git_branch) {
      throw new Error('Cannot delete current branch')
    }

    await gitExecLogged(terminal, ['branch', '-D', input.branch], {
      terminalId: input.terminalId,
      timeout: 10000,
    })

    if (input.deleteRemote) {
      await gitExecLogged(
        terminal,
        ['push', 'origin', '--delete', input.branch],
        { terminalId: input.terminalId, timeout: 30000 },
      )
    }

    return { deletedRemote: !!input.deleteRemote }
  })

export const renameBranchMutation = publicProcedure
  .input(renameBranchInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    // Pre-check: ensure target name doesn't already exist
    const listResult = await gitExecLogged(
      terminal,
      ['branch', '--list', input.newName],
      { terminalId: input.terminalId, errorOnly: true, timeout: 5000 },
    ).catch(() => ({ stdout: '', stderr: '' }))
    if (listResult.stdout.trim()) {
      throw new Error(`Branch '${input.newName}' already exists`)
    }

    await gitExecLogged(
      terminal,
      ['branch', '-m', input.branch, input.newName],
      { terminalId: input.terminalId, timeout: 10000 },
    )

    let renamedRemote = false
    if (input.renameRemote) {
      try {
        await gitExecLogged(
          terminal,
          ['push', 'origin', '--delete', input.branch],
          { terminalId: input.terminalId, timeout: 30000 },
        )
        await gitExecLogged(terminal, ['push', '-u', 'origin', input.newName], {
          terminalId: input.terminalId,
          timeout: 30000,
        })
        renamedRemote = true
      } catch (remoteErr) {
        log.error(
          { err: remoteErr },
          `[git] Failed to rename remote branch ${input.branch} to ${input.newName}`,
        )
      }
    }

    detectGitBranch(input.terminalId)

    return { renamedRemote }
  })

export const createBranchMutation = publicProcedure
  .input(createBranchInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)

    await gitExecLogged(terminal, ['checkout', '-b', input.name, input.from], {
      terminalId: input.terminalId,
      timeout: 30000,
    })

    detectGitBranch(input.terminalId)
    checkAndEmitSingleGitDirty(input.terminalId)
  })
