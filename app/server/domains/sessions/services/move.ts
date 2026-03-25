import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSessionById, updateSessionMove } from '@domains/sessions/db'
import {
  getAllTerminals,
  getProjectByPath,
  getTerminalById,
} from '@domains/workspace/db/terminals'
import { withTransaction } from '@server/lib/db'
import { sanitizeName, shellEscape } from '@server/lib/strings'
import { execSSHCommand } from '@server/ssh/exec'

export async function getMoveTargets(sessionId: string) {
  const session = await getSessionById(sessionId)
  if (!session) throw new Error('Session not found')

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
        const encodedPath = sanitizeName(projectPath)
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
}

export async function moveSession(
  sessionId: string,
  targetProjectPath: string,
  targetTerminalId: number,
) {
  // Validate session
  const session = await getSessionById(sessionId)
  if (!session) throw new Error('Session not found')
  if (!session.transcript_path)
    throw new Error('Session has no transcript path')
  if (session.status !== 'ended')
    throw new Error('Session must be exited in Claude before moving')

  // Validate target terminal
  const targetTerminal = await getTerminalById(targetTerminalId)
  if (!targetTerminal) throw new Error('Target terminal not found')

  // Validate SSH context matches
  const sessionTerminal = session.terminal_id
    ? await getTerminalById(session.terminal_id)
    : null
  const sessionSshHost = sessionTerminal?.ssh_host ?? null
  const targetSshHost = targetTerminal.ssh_host ?? null
  if (sessionSshHost !== targetSshHost)
    throw new Error('Cannot move between local and SSH contexts')

  // Compute paths
  const sourceProjectPath = session.project_path
  const sourceEncoded = sanitizeName(sourceProjectPath)
  const targetEncoded = sanitizeName(targetProjectPath)

  const transcriptFile = path.basename(session.transcript_path)
  const sessionDirName = sessionId
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
  const snapshotDir = `/tmp/move-session-${sourceEncoded}-${sessionId}-to-${targetEncoded}`
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
        try {
          await execSSHCommand(
            sessionSshHost,
            `mv ${shellEscape(targetTranscript)} ${shellEscape(sourceTranscript)} 2>/dev/null; ` +
              `mv ${shellEscape(targetSessionDir)} ${shellEscape(sourceSessionDir)} 2>/dev/null; true`,
          )
        } catch {
          /* best effort */
        }
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
      sessionId,
      sourceProjectPath,
      targetProjectPath,
    )

    // Step 3: Update sessions-index.json
    if (sessionSshHost) {
      await updateSessionsIndexRemote(
        sessionSshHost,
        sourceClaudeDir,
        targetClaudeDir,
        sessionId,
        targetTranscript,
        targetProjectPath,
      )
    } else {
      await updateSessionsIndexLocal(
        resolvePath(sourceClaudeDir),
        resolvePath(targetClaudeDir),
        sessionId,
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
        sessionId,
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
    throw new MoveError(message, snapshotDir)
  }
}

export class MoveError extends Error {
  snapshotDir: string
  constructor(message: string, snapshotDir: string) {
    super(message)
    this.name = 'MoveError'
    this.snapshotDir = snapshotDir
  }
}

// --- File I/O helpers ---

async function readLocalFile(filePath: string) {
  try {
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function readRemoteFile(sshHost: string, filePath: string) {
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

async function readRemoteJson(sshHost: string, filePath: string) {
  try {
    const { stdout } = await execSSHCommand(
      sshHost,
      `cat ${shellEscape(filePath)}`,
    )
    return JSON.parse(stdout) as Record<string, unknown>
  } catch {
    return null
  }
}

async function writeRemoteJson(
  sshHost: string,
  filePath: string,
  data: Record<string, unknown>,
) {
  const json = JSON.stringify(data, null, 2)
  await execSSHCommand(
    sshHost,
    `cat > ${shellEscape(filePath)} << 'WORKIO_EOF'\n${json}\nWORKIO_EOF`,
  )
}

// --- Index file manipulation ---

async function updateSessionsIndexLocal(
  sourceDir: string,
  targetDir: string,
  sessionId: string,
  newFullPath: string,
  newProjectPath: string,
) {
  const sourceIndexPath = path.join(sourceDir, 'sessions-index.json')
  const targetIndexPath = path.join(targetDir, 'sessions-index.json')

  let sourceData: Record<string, unknown>
  try {
    const raw = await fs.promises.readFile(sourceIndexPath, 'utf-8')
    sourceData = JSON.parse(raw)
  } catch {
    return
  }

  const entries: Record<string, unknown>[] =
    (sourceData.entries as Record<string, unknown>[]) ?? []
  const entry = entries.find(
    (e) => (e as { sessionId: string }).sessionId === sessionId,
  )

  sourceData.entries = entries.filter(
    (e) => (e as { sessionId: string }).sessionId !== sessionId,
  )
  await fs.promises.writeFile(
    sourceIndexPath,
    JSON.stringify(sourceData, null, 2),
  )

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

async function updateSessionsIndexRemote(
  sshHost: string,
  sourceClaudeDir: string,
  targetClaudeDir: string,
  sessionId: string,
  newFullPath: string,
  newProjectPath: string,
) {
  const sourceIndex = `${sourceClaudeDir}/sessions-index.json`
  const targetIndex = `${targetClaudeDir}/sessions-index.json`

  const sourceData = await readRemoteJson(sshHost, sourceIndex)
  if (!sourceData) return

  const entries = (sourceData.entries ?? []) as Record<string, unknown>[]
  const entry = entries.find((e) => e.sessionId === sessionId)

  sourceData.entries = entries.filter((e) => e.sessionId !== sessionId)
  await writeRemoteJson(sshHost, sourceIndex, sourceData)

  if (!entry) return

  let targetData = await readRemoteJson(sshHost, targetIndex)
  if (!targetData) {
    targetData = { version: 1, entries: [], originalPath: newProjectPath }
  }

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
) {
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
