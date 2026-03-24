import fs from 'node:fs'
import path from 'node:path'
import { logCommand } from '@domains/logs/db'
import {
  checkAndEmitSingleGitDirty,
  detectGitBranch,
} from '@domains/pty/monitor'
import { getTerminalById } from '@domains/workspace/db/terminals'
import type { FastifyInstance } from 'fastify'
import { gitExec, gitExecLogged } from '../lib/git'
import { expandPath, shellEscape } from '../lib/strings'
import { log } from '../logger'
import { execSSHCommand } from '../ssh/exec'

interface UndoCommitBody {
  commitHash: string
}

interface DropCommitBody {
  commitHash: string
}

interface TerminalParams {
  id: string
}

function parseId(raw: string, label = 'terminal'): number {
  const id = parseInt(raw, 10)
  if (Number.isNaN(id)) {
    const err = new Error(`Invalid ${label} id`) as Error & {
      statusCode: number
    }
    err.statusCode = 400
    throw err
  }
  return id
}

async function resolveTerminal(params: TerminalParams) {
  const id = parseId(params.id)
  const terminal = await getTerminalById(id)
  if (!terminal) {
    const err = new Error('Terminal not found') as Error & {
      statusCode: number
    }
    err.statusCode = 404
    throw err
  }
  return terminal
}

async function resolveGitTerminal(params: TerminalParams) {
  const terminal = await resolveTerminal(params)
  if (!terminal.git_repo) {
    const err = new Error('Not a git repository') as Error & {
      statusCode: number
    }
    err.statusCode = 400
    throw err
  }
  return terminal as typeof terminal & {
    git_repo: NonNullable<(typeof terminal)['git_repo']>
  }
}

export default async function terminalRoutes(fastify: FastifyInstance) {
  // Commit changes
  fastify.post<{
    Params: TerminalParams
    Body: {
      message: string
      amend?: boolean
      noVerify?: boolean
      files?: string[]
    }
  }>('/api/terminals/:id/commit', async (request, reply) => {
    const terminal = await resolveGitTerminal(request.params)
    const id = terminal.id

    const { message, amend, noVerify, files } = request.body

    try {
      // Stage files
      if (files && files.length > 0) {
        // Selective staging: reset then add specific files
        await gitExec(terminal, ['reset', 'HEAD'], { timeout: 30000 }).catch(
          (err) =>
            log.error(
              { err, terminalId: id },
              '[git] Failed to reset HEAD (may be fresh repo)',
            ),
        )
        await gitExecLogged(terminal, ['add', '--', ...files], {
          terminalId: id,
          timeout: 30000,
        })
      } else {
        // Stage all changes (default)
        await gitExecLogged(terminal, ['add', '-A'], {
          terminalId: id,
          timeout: 30000,
        })
      }

      if (amend) {
        const amendArgs = ['commit', '--amend', '--no-edit']
        if (noVerify) amendArgs.push('--no-verify')
        await gitExecLogged(terminal, amendArgs, {
          terminalId: id,
          timeout: 30000,
        })
      } else {
        if (!message?.trim()) {
          return reply.status(400).send({ error: 'Commit message is required' })
        }
        const commitArgs = ['commit', '-m', message]
        if (noVerify) commitArgs.push('--no-verify')
        await gitExecLogged(terminal, commitArgs, {
          terminalId: id,
          timeout: 30000,
        })
      }

      // Refresh git state
      detectGitBranch(id).catch((err) =>
        log.error({ err, terminalId: id }, '[git] Failed to detect branch'),
      )
      checkAndEmitSingleGitDirty(id, true)

      return { success: true }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to commit'
      return reply.status(400).send({
        success: false,
        error: errorMessage,
      })
    }
  })

  // Discard changes for selected files
  fastify.post<{
    Params: TerminalParams
    Body: { files: string[] }
  }>('/api/terminals/:id/discard', async (request, reply) => {
    const terminal = await resolveGitTerminal(request.params)
    const id = terminal.id

    const { files } = request.body
    if (!files || files.length === 0) {
      return reply.status(400).send({ error: 'No files specified' })
    }

    try {
      // Get file statuses to determine which git commands to use
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

      // Parse statuses
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

      const requestedSet = new Set(files)
      const trackedToRevert = files.filter(
        (f) => !untrackedFiles.has(f) && !addedFiles.has(f),
      )
      const stagedNew = files.filter(
        (f) => addedFiles.has(f) && requestedSet.has(f),
      )
      const untracked = files.filter(
        (f) => untrackedFiles.has(f) && requestedSet.has(f),
      )

      if (trackedToRevert.length > 0) {
        await gitExecLogged(
          terminal,
          ['checkout', 'HEAD', '--', ...trackedToRevert],
          {
            terminalId: id,
            timeout: 30000,
          },
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

      return { success: true }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to discard changes'
      return reply.status(400).send({
        success: false,
        error: errorMessage,
      })
    }
  })

  // Undo the most recent commit (soft reset)
  fastify.post<{ Params: TerminalParams; Body: UndoCommitBody }>(
    '/api/terminals/:id/undo-commit',
    async (request, reply) => {
      const terminal = await resolveGitTerminal(request.params)
      const id = terminal.id

      const { commitHash } = request.body
      if (!commitHash) {
        return reply.status(400).send({ error: 'commitHash is required' })
      }

      try {
        const headResult = await gitExec(terminal, ['rev-parse', 'HEAD'], {
          timeout: 5000,
        })
        const headHash = headResult.stdout.trim()

        if (
          !headHash.startsWith(commitHash) &&
          !commitHash.startsWith(headHash.slice(0, commitHash.length))
        ) {
          return reply.status(400).send({
            error: 'Commit is not the current HEAD',
          })
        }

        await gitExecLogged(terminal, ['reset', '--soft', 'HEAD~1'], {
          terminalId: id,
          timeout: 10000,
        })

        detectGitBranch(id)
        checkAndEmitSingleGitDirty(id)

        return { success: true }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to undo commit'
        return reply.status(400).send({
          success: false,
          error: errorMessage,
        })
      }
    },
  )

  // Drop a specific commit via non-interactive rebase
  fastify.post<{ Params: TerminalParams; Body: DropCommitBody }>(
    '/api/terminals/:id/drop-commit',
    async (request, reply) => {
      const terminal = await resolveGitTerminal(request.params)
      const id = terminal.id

      const { commitHash } = request.body
      if (!commitHash) {
        return reply.status(400).send({ error: 'commitHash is required' })
      }

      try {
        const parentResult = await gitExec(
          terminal,
          ['rev-parse', `${commitHash}~1`],
          { timeout: 5000 },
        )
        const parentHash = parentResult.stdout.trim()

        const shortHash = commitHash.slice(0, 7)
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

        detectGitBranch(id)
        checkAndEmitSingleGitDirty(id)

        return { success: true }
      } catch (err) {
        await gitExec(terminal, ['rebase', '--abort'], {
          timeout: 10000,
        }).catch(() => {})

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to drop commit'
        return reply.status(400).send({
          success: false,
          error: errorMessage,
        })
      }
    },
  )
}
