import fs from 'node:fs'
import path from 'node:path'
import { logCommand } from '@domains/logs/db'
import {
  checkAndEmitSingleGitDirty,
  detectGitBranch,
} from '@domains/pty/monitor'
import { gitExec, gitExecLogged } from '@server/lib/git'
import { expandPath, shellEscape } from '@server/lib/strings'
import { log } from '@server/logger'
import { execSSHCommand } from '@server/ssh/exec'
import { publicProcedure } from '@server/trpc'
import { resolveGitTerminal } from '../resolve'
import { commitHashInput, commitInput, discardInput } from '../schema'

export const commitMutation = publicProcedure
  .input(commitInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const id = terminal.id

    // Stage files
    if (input.files && input.files.length > 0) {
      await gitExec(terminal, ['reset', 'HEAD'], { timeout: 30000 }).catch(
        (err) =>
          log.error(
            { err, terminalId: id },
            '[git] Failed to reset HEAD (may be fresh repo)',
          ),
      )
      await gitExecLogged(terminal, ['add', '--', ...input.files], {
        terminalId: id,
        timeout: 30000,
      })
    } else {
      await gitExecLogged(terminal, ['add', '-A'], {
        terminalId: id,
        timeout: 30000,
      })
    }

    if (input.amend) {
      const amendArgs = ['commit', '--amend', '--no-edit']
      if (input.noVerify) amendArgs.push('--no-verify')
      await gitExecLogged(terminal, amendArgs, {
        terminalId: id,
        timeout: 30000,
      })
    } else {
      if (!input.message?.trim()) {
        throw new Error('Commit message is required')
      }
      const commitArgs = ['commit', '-m', input.message]
      if (input.noVerify) commitArgs.push('--no-verify')
      await gitExecLogged(terminal, commitArgs, {
        terminalId: id,
        timeout: 30000,
      })
    }

    detectGitBranch(id).catch((err) =>
      log.error({ err, terminalId: id }, '[git] Failed to detect branch'),
    )
    checkAndEmitSingleGitDirty(id, true)
  })

export const discardMutation = publicProcedure
  .input(discardInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const id = terminal.id

    const safe = (args: string[]) =>
      gitExec(terminal, args, { timeout: 10000 }).then(
        (r) => r.stdout,
        () => '',
      )

    const [nameStatusOut, untrackedOut] = await Promise.all([
      safe(['diff', '--name-status', 'HEAD']).then(
        (out) => out || safe(['diff', '--name-status']),
      ),
      safe(['ls-files', '--others', '--exclude-standard']),
    ])

    const untrackedFiles = new Set(
      untrackedOut
        .trim()
        .split('\n')
        .filter((l) => l),
    )
    const addedFiles = new Set<string>()
    for (const line of nameStatusOut.trim().split('\n')) {
      if (!line) continue
      const parts = line.split('\t')
      if (parts[0] === 'A') addedFiles.add(parts[1])
    }

    const requestedSet = new Set(input.files)
    const trackedToRevert = input.files.filter(
      (f) => !untrackedFiles.has(f) && !addedFiles.has(f),
    )
    const stagedNew = input.files.filter(
      (f) => addedFiles.has(f) && requestedSet.has(f),
    )
    const untracked = input.files.filter(
      (f) => untrackedFiles.has(f) && requestedSet.has(f),
    )

    if (trackedToRevert.length > 0) {
      await gitExecLogged(
        terminal,
        ['checkout', 'HEAD', '--', ...trackedToRevert],
        { terminalId: id, timeout: 30000 },
      )
    }

    if (stagedNew.length > 0) {
      await gitExecLogged(terminal, ['rm', '-f', '--', ...stagedNew], {
        terminalId: id,
        timeout: 30000,
      })
    }

    if (untracked.length > 0) {
      if (terminal.ssh_host) {
        const rmCmd = `rm -f -- ${untracked.map((f) => shellEscape(f)).join(' ')}`
        await execSSHCommand(terminal.ssh_host, rmCmd, {
          cwd: terminal.cwd,
        })
        logCommand({
          terminalId: id,
          category: 'git',
          command: rmCmd,
          stdout: '',
          stderr: '',
        })
      } else {
        const cwdPath = expandPath(terminal.cwd)
        await Promise.all(
          untracked.map((f) =>
            fs.promises
              .unlink(path.join(cwdPath, f))
              .catch((err) =>
                log.error(
                  { err, file: f },
                  '[git] Failed to delete untracked file',
                ),
              ),
          ),
        )
        logCommand({
          terminalId: id,
          category: 'git',
          command: `rm ${untracked.join(' ')}`,
          stdout: '',
          stderr: '',
        })
      }
    }

    checkAndEmitSingleGitDirty(id, true)
  })

export const undoCommitMutation = publicProcedure
  .input(commitHashInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const id = terminal.id

    const headResult = await gitExec(terminal, ['rev-parse', 'HEAD'], {
      timeout: 5000,
    })
    const headHash = headResult.stdout.trim()

    if (
      !headHash.startsWith(input.commitHash) &&
      !input.commitHash.startsWith(headHash.slice(0, input.commitHash.length))
    ) {
      throw new Error('Commit is not the current HEAD')
    }

    await gitExecLogged(terminal, ['reset', '--soft', 'HEAD~1'], {
      terminalId: id,
      timeout: 10000,
    })

    detectGitBranch(id)
    checkAndEmitSingleGitDirty(id)
  })

export const dropCommitMutation = publicProcedure
  .input(commitHashInput)
  .mutation(async ({ input }) => {
    const terminal = await resolveGitTerminal(input.terminalId)
    const id = terminal.id

    try {
      const parentResult = await gitExec(
        terminal,
        ['rev-parse', `${input.commitHash}~1`],
        { timeout: 5000 },
      )
      const parentHash = parentResult.stdout.trim()

      const shortHash = input.commitHash.slice(0, 7)
      const sedScript = `sed -i.bak 's/^pick ${shortHash}/drop ${shortHash}/'`

      await gitExecLogged(
        terminal,
        ['rebase', '-i', '--no-autosquash', parentHash],
        {
          terminalId: id,
          timeout: 60000,
          env: { GIT_SEQUENCE_EDITOR: sedScript },
        },
      )
    } catch (err) {
      await gitExec(terminal, ['rebase', '--abort'], {
        timeout: 10000,
      }).catch(() => {})
      throw err
    }

    detectGitBranch(id)
    checkAndEmitSingleGitDirty(id)
  })
