import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  getSessionTranscriptPaths,
  getSettings,
  getTerminalById,
  insertBackfilledSession,
  searchSessionMessages,
  updateSession,
  updateSessionData,
  updateSessionMove,
  updateSettings,
  upsertProject,
  withTransaction,
} from '../db'
import { log } from '../logger'
import { execSSHCommand } from '../ssh/exec'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  fastify.get<{
    Querystring: { q?: string; repo?: string; branch?: string; all?: string }
  }>('/api/sessions/search', async (request, reply) => {
    const q = request.query.q?.trim()
    const repo = request.query.repo?.trim()
    const branch = request.query.branch?.trim()
    const recentOnly = request.query.all !== '1'

    const hasTextQuery = q != null && q.length >= 2
    const hasFilter =
      repo != null && repo.length > 0 && branch != null && branch.length > 0

    if (!hasTextQuery && !hasFilter) {
      return reply.status(400).send({
        error:
          'Query must be at least 2 characters or repo+branch filter is required',
      })
    }

    return await searchSessionMessages(
      hasTextQuery ? q! : null,
      100,
      hasFilter ? { repo: repo!, branch: branch! } : undefined,
      recentOnly,
    )
  })

  // Check for unbackfilled JSONL sessions
  fastify.get<{ Querystring: { weeksBack?: string } }>(
    '/api/sessions/backfill-check',
    async (request) => {
      const weeksBack = Number(request.query.weeksBack) || 4
      const cutoff = Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000

      const allTerminals = await getAllTerminals()
      const localTerminals = allTerminals.filter((t) => !t.ssh_host)

      const results: {
        cwd: string
        encodedPath: string
        terminalId: number
        shellId: number
        totalFiles: number
        unbackfilledCount: number
      }[] = []

      for (const t of localTerminals) {
        if (!t.cwd) continue
        const mainShellId = t.shells?.[0]?.id
        if (!mainShellId) continue

        const encodedPath = encodeProjectPath(t.cwd)
        const claudeDir = path.join(
          os.homedir(),
          '.claude',
          'projects',
          encodedPath,
        )

        let files: string[]
        try {
          await fs.promises.access(claudeDir)
          const entries = await fs.promises.readdir(claudeDir)
          files = entries.filter((f) => f.endsWith('.jsonl'))
        } catch {
          continue
        }

        if (files.length === 0) continue

        const knownPaths = await getSessionTranscriptPaths(encodedPath)
        const knownSet = new Set(knownPaths)
        const unknownFiles = files.filter(
          (f) => !knownSet.has(path.join(claudeDir, f)),
        )

        // Filter out non-session files and by timestamp
        let eligible = 0
        for (const f of unknownFiles) {
          const fullPath = path.join(claudeDir, f)
          if (!(await isRealSession(fullPath))) continue
          const ts = await readLastTimestamp(fullPath)
          if (ts && new Date(ts).getTime() >= cutoff) eligible++
        }

        if (eligible > 0) {
          results.push({
            cwd: t.cwd,
            encodedPath,
            terminalId: t.id,
            shellId: mainShellId,
            totalFiles: files.length,
            unbackfilledCount: eligible,
          })
        }
      }

      return { results }
    },
  )

  // Backfill untracked JSONL sessions into the database
  fastify.post<{
    Body: {
      encodedPath: string
      cwd: string
      terminalId: number
      shellId: number
      weeksBack: number
    }
  }>('/api/sessions/backfill', async (request, reply) => {
    const { encodedPath, cwd, terminalId, shellId, weeksBack } = request.body

    if (!terminalId || !shellId) {
      return reply
        .status(400)
        .send({ error: 'terminalId and shellId are required' })
    }

    const claudeDir = path.join(
      os.homedir(),
      '.claude',
      'projects',
      encodedPath,
    )

    let allFiles: string[]
    try {
      const entries = await fs.promises.readdir(claudeDir)
      allFiles = entries.filter((f) => f.endsWith('.jsonl'))
    } catch {
      return reply
        .status(400)
        .send({ error: 'Claude project directory not found' })
    }

    // Filter out files already in DB
    const knownPaths = await getSessionTranscriptPaths(encodedPath)
    const knownSet = new Set(knownPaths)
    const newFiles = allFiles.filter(
      (f) => !knownSet.has(path.join(claudeDir, f)),
    )

    if (newFiles.length === 0) {
      return { backfilled: 0 }
    }

    // Read last timestamp from each file, filter by weeksBack
    const cutoff = Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000
    const eligible: {
      file: string
      sessionId: string
      timestamp: string
    }[] = []

    for (const file of newFiles) {
      const fullPath = path.join(claudeDir, file)
      if (!(await isRealSession(fullPath))) continue
      const ts = await readLastTimestamp(fullPath)
      if (ts && new Date(ts).getTime() >= cutoff) {
        eligible.push({
          file,
          sessionId: file.replace('.jsonl', ''),
          timestamp: ts,
        })
      }
    }

    if (eligible.length === 0) {
      return { backfilled: 0 }
    }

    const projectId = await upsertProject(cwd)

    // Insert all sessions under the single terminal
    await withTransaction(async (client) => {
      for (const e of eligible) {
        await insertBackfilledSession(
          e.sessionId,
          projectId,
          terminalId,
          shellId,
          path.join(claudeDir, e.file),
          e.timestamp,
          client,
        )
      }
    })

    // Set branch data and restore updated_at (the trigger overrides it on UPDATE)
    const terminal = await getTerminalById(terminalId)
    const repo = terminal?.git_repo?.repo ?? ''
    for (const e of eligible) {
      const { branch, allBranches } = await readSessionBranches(
        path.join(claudeDir, e.file),
      )
      if (branch) {
        await updateSessionData(e.sessionId, {
          branch,
          repo,
          branches: allBranches.map((b) => ({ branch: b, repo })),
        })
      }
    }

    // Restore updated_at after branch updates (trigger resets it to NOW())
    await withTransaction(async (client) => {
      await client.query(
        `ALTER TABLE sessions DISABLE TRIGGER sessions_updated_at`,
      )
      for (const e of eligible) {
        await client.query(
          `UPDATE sessions SET updated_at = $1 WHERE session_id = $2`,
          [e.timestamp, e.sessionId],
        )
      }
      await client.query(
        `ALTER TABLE sessions ENABLE TRIGGER sessions_updated_at`,
      )
    })

    // Spawn workers for each session (fire and forget)
    const projectRoot = path.resolve(__dirname, '..', '..', '..')
    const debounceDir = path.join(projectRoot, 'debounce')
    try {
      await fs.promises.mkdir(debounceDir, { recursive: true })
    } catch {
      // ignore
    }

    for (const e of eligible) {
      // Use naive local ISO timestamp to match Python's datetime.now().isoformat()
      const now = new Date()
        .toLocaleString('sv-SE', { hour12: false })
        .replace(' ', 'T')
      const markerFile = path.join(debounceDir, `${e.sessionId}.marker`)

      try {
        await fs.promises.writeFile(
          markerFile,
          JSON.stringify({ start: now, latest: now }),
        )
      } catch {
        // non-fatal
      }

      try {
        const workerPath = path.join(projectRoot, 'worker.py')
        const child = spawn('python3', [workerPath, e.sessionId, now], {
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
      } catch (err) {
        log.error(
          { err, sessionId: e.sessionId },
          '[backfill] Failed to spawn worker',
        )
      }
    }

    return { backfilled: eligible.length }
  })

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
    const limit = Math.min(Number(request.query.limit) || 30, 10000)
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

      // Step 2: Append meta message to transcript so Claude knows the project moved
      await appendMoveMetaMessage(
        sessionSshHost,
        resolvePath(targetTranscript),
        id,
        sourceProjectPath,
        targetProjectPath,
      )

      // Step 3: Update sessions-index.json
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

      // Step 4: DB update in a transaction
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

/** Check if a JSONL file is a real session (reads first 64KB for user/assistant type). */
async function isRealSession(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath)
    const readSize = Math.min(stat.size, 65536)
    const buf = Buffer.alloc(readSize)
    const fd = await fs.promises.open(filePath, 'r')
    await fd.read(buf, 0, readSize, 0)
    await fd.close()
    const head = buf.toString('utf-8')
    return head.includes('"type":"user"') || head.includes('"type":"assistant"')
  } catch {
    return false
  }
}

/** Extract all unique gitBranch values from a JSONL file (reads last 64KB for latest branch). */
async function readSessionBranches(
  filePath: string,
): Promise<{ branch: string | null; allBranches: string[] }> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    const branches = new Set<string>()
    let lastBranch: string | null = null
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      const match = line.match(/"gitBranch":"([^"]+)"/)
      if (match) {
        branches.add(match[1])
        lastBranch = match[1]
      }
    }
    return { branch: lastBranch, allBranches: [...branches] }
  } catch {
    return { branch: null, allBranches: [] }
  }
}

/** Read the last timestamp from a JSONL file. */
async function readLastTimestamp(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(filePath)
    // Use 64KB — many JSONL files have large base64 tool outputs that push
    // timestamp-bearing lines well beyond a 4KB tail window
    const readSize = Math.min(stat.size, 65536)
    const buf = Buffer.alloc(readSize)
    const fd = await fs.promises.open(filePath, 'r')
    await fd.read(buf, 0, readSize, Math.max(0, stat.size - readSize))
    await fd.close()

    const lines = buf.toString('utf-8').split('\n').reverse()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.timestamp) return obj.timestamp as string
      } catch {
        // skip malformed/truncated lines
      }
    }

    // Fallback: use file mtime when no parseable timestamp found
    return stat.mtime.toISOString()
  } catch {
    // skip unreadable files
  }
  return null
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

async function appendMoveMetaMessage(
  sshHost: string | null,
  transcriptPath: string,
  sessionId: string,
  oldProjectPath: string,
  newProjectPath: string,
): Promise<void> {
  // Read transcript to find last uuid and session metadata
  let content: string
  if (sshHost) {
    const result = await execSSHCommand(
      sshHost,
      `cat ${shellEscape(transcriptPath)}`,
    )
    content = result.stdout
  } else {
    content = await fs.promises.readFile(transcriptPath, 'utf-8')
  }

  // Scan lines in reverse to find last uuid and pick up version/gitBranch/slug
  const lines = content.trimEnd().split('\n')
  let parentUuid: string | null = null
  let version = ''
  let gitBranch = ''
  let slug: string | undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i])
      if (!version && obj.version) version = obj.version
      if (!gitBranch && obj.gitBranch) gitBranch = obj.gitBranch
      if (slug === undefined && obj.slug) slug = obj.slug
      if (!parentUuid && obj.uuid) parentUuid = obj.uuid
      if (parentUuid && version) break
    } catch {
      // skip malformed lines
    }
  }

  const metaMessage: Record<string, unknown> = {
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: newProjectPath,
    sessionId,
    version,
    gitBranch,
    type: 'user',
    message: {
      role: 'user',
      content:
        `[Session moved] This session has been moved from ${oldProjectPath} to ${newProjectPath}. ` +
        `The current working directory is now ${newProjectPath}. ` +
        'All file paths from previous messages that referenced the old project directory should be understood as now being in the new project directory or missing. ' +
        'Always use the new project path for any file operations going forward.',
    },
    isMeta: true,
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  }
  if (slug) metaMessage.slug = slug

  const line = `\n${JSON.stringify(metaMessage)}`
  if (sshHost) {
    await execSSHCommand(
      sshHost,
      `printf '%s' ${shellEscape(line)} >> ${shellEscape(transcriptPath)}`,
    )
  } else {
    await fs.promises.appendFile(transcriptPath, line)
  }
}
