import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import {
  deleteSession,
  deleteSessions,
  getActivePermissions,
  getAllSessions,
  getAllTerminals,
  getOldSessionIds,
  getProjectByPath,
  getSessionById,
  getSessionMessages,
  getSettings,
  getTerminalById,
  searchSessionMessages,
  updateSession,
  updateSessionMove,
  updateSettings,
  withTransaction,
} from '../db'
import { execSSHCommand } from '../ssh/exec'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // List all Claude sessions with project paths
  fastify.get('/api/sessions', async () => {
    const [sessions, settings] = await Promise.all([
      getAllSessions(),
      getSettings(),
    ])
    const favorites = settings.favorite_sessions ?? []
    const favoriteSet = new Set(favorites)

    // Cleanup stale favorites
    const sessionIds = new Set(sessions.map((s) => s.session_id))
    const cleaned = favorites.filter((id) => sessionIds.has(id))
    if (cleaned.length !== favorites.length) {
      updateSettings({ favorite_sessions: cleaned })
    }

    return sessions.map((s) => ({
      ...s,
      is_favorite: favoriteSet.has(s.session_id),
    }))
  })

  // Toggle favorite status for a session
  fastify.post<{ Params: { id: string } }>(
    '/api/sessions/:id/favorite',
    async (request) => {
      const { id } = request.params
      const settings = await getSettings()
      const favorites = settings.favorite_sessions ?? []
      const index = favorites.indexOf(id)
      const isFavorite = index === -1
      const updated = isFavorite
        ? [...favorites, id]
        : favorites.filter((fid) => fid !== id)
      await updateSettings({ favorite_sessions: updated })
      return { is_favorite: isFavorite }
    },
  )

  // Cleanup old sessions
  fastify.post<{ Body: { weeks: number } }>(
    '/api/sessions/cleanup',
    async (request, reply) => {
      const { weeks } = request.body
      if (!weeks || weeks < 1) {
        return reply.status(400).send({ error: 'weeks must be at least 1' })
      }
      const settings = await getSettings()
      const favoriteIds = settings.favorite_sessions ?? []
      const oldIds = await getOldSessionIds(weeks, favoriteIds)
      if (oldIds.length === 0) {
        return { deleted: 0 }
      }
      const deleted = await deleteSessions(oldIds)
      return { deleted }
    },
  )

  // Get active permissions across all sessions
  fastify.get('/api/permissions/active', async () => {
    return await getActivePermissions()
  })

  // Search session messages
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/sessions/search',
    async (request, reply) => {
      const q = request.query.q?.trim()
      if (!q || q.length < 2) {
        return reply
          .status(400)
          .send({ error: 'Query must be at least 2 characters' })
      }
      return await searchSessionMessages(q)
    },
  )

  // Get a single session by ID
  fastify.get<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const session = await getSessionById(id)
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return session
    },
  )

  // Update a session (rename)
  fastify.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const updated = await updateSession(id, request.body)
      if (!updated) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return { ok: true }
    },
  )

  // Delete a session and all related data
  fastify.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      const deleted = await deleteSession(id)
      if (!deleted) {
        return reply.status(404).send({ error: 'Session not found' })
      }
      return { ok: true }
    },
  )

  // Bulk delete sessions
  fastify.delete<{ Body: { ids: string[] } }>(
    '/api/sessions',
    async (request, reply) => {
      const { ids } = request.body
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids array is required' })
      }
      const deleted = await deleteSessions(ids)
      return { ok: true, deleted }
    },
  )

  // Get paginated messages for a session
  fastify.get<{
    Params: { id: string }
    Querystring: { limit?: string; offset?: string }
  }>('/api/sessions/:id/messages', async (request) => {
    const { id } = request.params
    const limit = Math.min(Number(request.query.limit) || 30, 100)
    const offset = Number(request.query.offset) || 0
    return await getSessionMessages(id, limit, offset)
  })

  // Get move targets for a session (other projects it can be moved to)
  fastify.get<{ Params: { id: string } }>(
    '/api/sessions/:id/move-targets',
    async (request, reply) => {
      const { id } = request.params
      const session = await getSessionById(id)
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' })
      }

      // Get session's terminal to determine SSH host
      const sessionTerminal = session.terminal_id
        ? await getTerminalById(session.terminal_id)
        : null
      const sessionSshHost = sessionTerminal?.ssh_host ?? null

      // Get all terminals, filter by same SSH context
      const allTerminals = await getAllTerminals()
      const eligible = allTerminals.filter((t) => {
        if (sessionSshHost) {
          return t.ssh_host === sessionSshHost
        }
        return t.ssh_host == null
      })

      // Group by cwd (project path), exclude current project
      const projectMap = new Map<
        string,
        {
          terminalId: number
          terminalName: string | null
          sshHost: string | null
        }
      >()
      for (const t of eligible) {
        if (t.cwd === session.project_path) continue
        if (!projectMap.has(t.cwd)) {
          projectMap.set(t.cwd, {
            terminalId: t.id,
            terminalName: t.name,
            sshHost: t.ssh_host,
          })
        }
      }

      // Check if Claude project dir exists for each target
      const targets = await Promise.all(
        Array.from(projectMap.entries()).map(
          async ([projectPath, { terminalId, terminalName, sshHost }]) => {
            const encodedPath = encodeProjectPath(projectPath)
            const claudeDir = path.join(
              os.homedir(),
              '.claude',
              'projects',
              encodedPath,
            )
            let claudeDirExists = false
            try {
              if (sshHost) {
                const { stdout } = await execSSHCommand(
                  sshHost,
                  `test -d ~/.claude/projects/${shellEscape(encodedPath)} && echo yes || echo no`,
                )
                claudeDirExists = stdout.trim() === 'yes'
              } else {
                await fs.promises.access(claudeDir)
                claudeDirExists = true
              }
            } catch {
              claudeDirExists = false
            }
            return {
              projectPath,
              encodedPath,
              terminalId,
              terminalName,
              sshHost,
              claudeDirExists,
            }
          },
        ),
      )

      return { targets }
    },
  )

  // Move a session to a different project
  fastify.post<{
    Params: { id: string }
    Body: { targetProjectPath: string; targetTerminalId: number }
  }>('/api/sessions/:id/move', async (request, reply) => {
    const { id } = request.params
    const { targetProjectPath, targetTerminalId } = request.body

    // Validate session
    const session = await getSessionById(id)
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    if (!session.transcript_path) {
      return reply.status(400).send({ error: 'Session has no transcript path' })
    }
    if (session.status !== 'ended') {
      return reply
        .status(400)
        .send({ error: 'Session must be exited in Claude before moving' })
    }

    // Validate target terminal
    const targetTerminal = await getTerminalById(targetTerminalId)
    if (!targetTerminal) {
      return reply.status(404).send({ error: 'Target terminal not found' })
    }

    // Validate SSH context matches
    const sessionTerminal = session.terminal_id
      ? await getTerminalById(session.terminal_id)
      : null
    const sessionSshHost = sessionTerminal?.ssh_host ?? null
    const targetSshHost = targetTerminal.ssh_host ?? null
    if (sessionSshHost !== targetSshHost) {
      return reply
        .status(400)
        .send({ error: 'Cannot move between local and SSH contexts' })
    }

    // Compute paths
    const sourceProjectPath = session.project_path
    const sourceEncoded = encodeProjectPath(sourceProjectPath)
    const targetEncoded = encodeProjectPath(targetProjectPath)

    const transcriptFile = path.basename(session.transcript_path)
    const sessionDirName = id // session sub-directory name matches session_id
    const sourceClaudeDir = path.join('~/.claude/projects', sourceEncoded)
    const targetClaudeDir = path.join('~/.claude/projects', targetEncoded)
    const sourceTranscript = path.join(sourceClaudeDir, transcriptFile)
    const targetTranscript = path.join(targetClaudeDir, transcriptFile)
    const sourceSessionDir = path.join(sourceClaudeDir, sessionDirName)
    const targetSessionDir = path.join(targetClaudeDir, sessionDirName)

    // Snapshot everything we'll touch before making changes
    const homeDir = os.homedir()
    const resolvePath = (p: string) => p.replace('~', homeDir)
    const sourceIndexPath = path.join(sourceClaudeDir, 'sessions-index.json')
    const targetIndexPath = path.join(targetClaudeDir, 'sessions-index.json')

    let sourceIndexSnapshot: string | null = null
    let targetIndexSnapshot: string | null = null

    try {
      if (sessionSshHost) {
        sourceIndexSnapshot = await readRemoteFile(
          sessionSshHost,
          sourceIndexPath,
        )
        targetIndexSnapshot = await readRemoteFile(
          sessionSshHost,
          targetIndexPath,
        )
      } else {
        sourceIndexSnapshot = await readLocalFile(resolvePath(sourceIndexPath))
        targetIndexSnapshot = await readLocalFile(resolvePath(targetIndexPath))
      }
    } catch {
      // Snapshot read failures are fine — files may not exist yet
    }

    // Write snapshots to disk for manual recovery
    const snapshotDir = `/tmp/move-session-${sourceEncoded}-${id}-to-${targetEncoded}`
    try {
      if (sessionSshHost) {
        await execSSHCommand(
          sessionSshHost,
          `mkdir -p ${shellEscape(snapshotDir)}`,
        )
        if (sourceIndexSnapshot !== null) {
          await execSSHCommand(
            sessionSshHost,
            `cat > ${shellEscape(`${snapshotDir}/source-sessions-index.json`)} << 'WORKIO_EOF'\n${sourceIndexSnapshot}\nWORKIO_EOF`,
          )
        }
        if (targetIndexSnapshot !== null) {
          await execSSHCommand(
            sessionSshHost,
            `cat > ${shellEscape(`${snapshotDir}/target-sessions-index.json`)} << 'WORKIO_EOF'\n${targetIndexSnapshot}\nWORKIO_EOF`,
          )
        }
      } else {
        await fs.promises.mkdir(snapshotDir, { recursive: true })
        if (sourceIndexSnapshot !== null) {
          await fs.promises.writeFile(
            `${snapshotDir}/source-sessions-index.json`,
            sourceIndexSnapshot,
          )
        }
        if (targetIndexSnapshot !== null) {
          await fs.promises.writeFile(
            `${snapshotDir}/target-sessions-index.json`,
            targetIndexSnapshot,
          )
        }
      }
    } catch {
      // Non-fatal — snapshots are best-effort
    }

    const restoreSnapshots = async () => {
      try {
        if (sessionSshHost) {
          // Move files back
          try {
            await execSSHCommand(
              sessionSshHost,
              `mv ${shellEscape(targetTranscript)} ${shellEscape(sourceTranscript)} 2>/dev/null; ` +
                `mv ${shellEscape(targetSessionDir)} ${shellEscape(sourceSessionDir)} 2>/dev/null; true`,
            )
          } catch {
            /* best effort */
          }
          // Restore index snapshots
          if (sourceIndexSnapshot !== null) {
            await writeRemoteJson(
              sessionSshHost,
              sourceIndexPath,
              JSON.parse(sourceIndexSnapshot),
            )
          }
          if (targetIndexSnapshot !== null) {
            await writeRemoteJson(
              sessionSshHost,
              targetIndexPath,
              JSON.parse(targetIndexSnapshot),
            )
          } else {
            // Target index didn't exist before — remove it
            try {
              await execSSHCommand(
                sessionSshHost,
                `rm -f ${shellEscape(targetIndexPath)}`,
              )
            } catch {
              /* best effort */
            }
          }
        } else {
          // Move files back
          try {
            await fs.promises.rename(
              resolvePath(targetTranscript),
              resolvePath(sourceTranscript),
            )
          } catch {
            /* best effort */
          }
          try {
            await fs.promises.rename(
              resolvePath(targetSessionDir),
              resolvePath(sourceSessionDir),
            )
          } catch {
            /* best effort */
          }
          // Restore index snapshots
          if (sourceIndexSnapshot !== null) {
            await fs.promises.writeFile(
              resolvePath(sourceIndexPath),
              sourceIndexSnapshot,
            )
          }
          if (targetIndexSnapshot !== null) {
            await fs.promises.writeFile(
              resolvePath(targetIndexPath),
              targetIndexSnapshot,
            )
          } else {
            try {
              await fs.promises.unlink(resolvePath(targetIndexPath))
            } catch {
              /* best effort */
            }
          }
        }
      } catch {
        // Restore failed — nothing more we can do
      }
    }

    try {
      // Step 1: Move files
      if (sessionSshHost) {
        await execSSHCommand(
          sessionSshHost,
          [
            `mkdir -p ${shellEscape(targetClaudeDir)}`,
            `mv ${shellEscape(sourceTranscript)} ${shellEscape(targetTranscript)}`,
            `if [ -d ${shellEscape(sourceSessionDir)} ]; then mv ${shellEscape(sourceSessionDir)} ${shellEscape(targetSessionDir)}; fi`,
          ].join(' && '),
        )
      } else {
        await fs.promises.mkdir(resolvePath(targetClaudeDir), {
          recursive: true,
        })
        await fs.promises.rename(
          resolvePath(sourceTranscript),
          resolvePath(targetTranscript),
        )
        try {
          await fs.promises.access(resolvePath(sourceSessionDir))
          await fs.promises.rename(
            resolvePath(sourceSessionDir),
            resolvePath(targetSessionDir),
          )
        } catch {
          // Session dir doesn't exist
        }
      }

      // Step 2: Update sessions-index.json
      if (sessionSshHost) {
        await updateSessionsIndexRemote(
          sessionSshHost,
          sourceClaudeDir,
          targetClaudeDir,
          id,
          targetTranscript,
          targetProjectPath,
        )
      } else {
        await updateSessionsIndexLocal(
          resolvePath(sourceClaudeDir),
          resolvePath(targetClaudeDir),
          id,
          resolvePath(targetTranscript),
          targetProjectPath,
        )
      }

      // Step 3: DB update in a transaction
      await withTransaction(async (client) => {
        const targetProject = await getProjectByPath(targetProjectPath)
        if (!targetProject) {
          throw new Error('Target project not found in database')
        }
        await updateSessionMove(
          id,
          targetProject.id,
          targetTerminalId,
          resolvePath(targetTranscript),
          client,
        )
      })

      return { ok: true, snapshotDir }
    } catch (err) {
      await restoreSnapshots()
      const message =
        err instanceof Error ? err.message : 'Failed to move session'
      return reply.status(500).send({ error: message, snapshotDir })
    }
  })
}

function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

async function readLocalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function readRemoteFile(
  sshHost: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execSSHCommand(
      sshHost,
      `cat ${shellEscape(filePath)}`,
    )
    return stdout
  } catch {
    return null
  }
}

async function updateSessionsIndexLocal(
  sourceDir: string,
  targetDir: string,
  sessionId: string,
  newFullPath: string,
  newProjectPath: string,
): Promise<void> {
  const sourceIndexPath = path.join(sourceDir, 'sessions-index.json')
  const targetIndexPath = path.join(targetDir, 'sessions-index.json')

  // Read source index and extract entry
  let sourceData: Record<string, unknown>
  try {
    const raw = await fs.promises.readFile(sourceIndexPath, 'utf-8')
    sourceData = JSON.parse(raw)
  } catch {
    // Source index doesn't exist — skip all index updates
    return
  }

  const entries: Record<string, unknown>[] =
    (sourceData.entries as Record<string, unknown>[]) ?? []
  const entry = entries.find(
    (e) => (e as { sessionId: string }).sessionId === sessionId,
  )

  // Remove entry from source
  sourceData.entries = entries.filter(
    (e) => (e as { sessionId: string }).sessionId !== sessionId,
  )
  await fs.promises.writeFile(
    sourceIndexPath,
    JSON.stringify(sourceData, null, 2),
  )

  // Add entry to target index (create if doesn't exist)
  if (!entry) return

  let targetData: Record<string, unknown>
  try {
    const targetRaw = await fs.promises.readFile(targetIndexPath, 'utf-8')
    targetData = JSON.parse(targetRaw)
  } catch {
    targetData = { version: 1, entries: [], originalPath: newProjectPath }
  }

  ;(entry as Record<string, unknown>).fullPath = newFullPath
  ;(entry as Record<string, unknown>).projectPath = newProjectPath
  ;(targetData.entries as Record<string, unknown>[]).push(entry)
  await fs.promises.writeFile(
    targetIndexPath,
    JSON.stringify(targetData, null, 2),
  )
}

async function readRemoteJson(
  sshHost: string,
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await execSSHCommand(
      sshHost,
      `cat ${shellEscape(filePath)}`,
    )
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

async function writeRemoteJson(
  sshHost: string,
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(data, null, 2)
  await execSSHCommand(
    sshHost,
    `cat > ${shellEscape(filePath)} << 'WORKIO_EOF'\n${json}\nWORKIO_EOF`,
  )
}

async function updateSessionsIndexRemote(
  sshHost: string,
  sourceClaudeDir: string,
  targetClaudeDir: string,
  sessionId: string,
  newFullPath: string,
  newProjectPath: string,
): Promise<void> {
  const sourceIndex = `${sourceClaudeDir}/sessions-index.json`
  const targetIndex = `${targetClaudeDir}/sessions-index.json`

  // Read source index
  const sourceData = await readRemoteJson(sshHost, sourceIndex)
  if (!sourceData) {
    // Source index doesn't exist — skip all index updates
    return
  }

  const entries = (sourceData.entries ?? []) as Record<string, unknown>[]
  const entry = entries.find((e) => e.sessionId === sessionId)

  // Remove entry from source
  sourceData.entries = entries.filter((e) => e.sessionId !== sessionId)
  await writeRemoteJson(sshHost, sourceIndex, sourceData)

  // Add entry to target index (create if doesn't exist)
  if (!entry) return

  let targetData = await readRemoteJson(sshHost, targetIndex)
  if (!targetData) {
    targetData = { version: 1, entries: [], originalPath: newProjectPath }
  }

  // Expand ~ to home dir on remote
  try {
    const { stdout } = await execSSHCommand(sshHost, 'echo ~')
    const homeDir = stdout.trim()
    entry.fullPath = (newFullPath as string).replace('~', homeDir)
  } catch {
    entry.fullPath = newFullPath
  }
  entry.projectPath = newProjectPath
  ;(targetData.entries as Record<string, unknown>[]).push(entry)
  await writeRemoteJson(sshHost, targetIndex, targetData)
}
