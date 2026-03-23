import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getAllTerminals,
  getTerminalById,
  upsertProject,
} from '@domains/workspace/db/terminals'
import { withTransaction } from '@server/lib/db'
import { sanitizeName } from '@server/lib/strings'
import { log } from '@server/logger'
import {
  getSessionTranscriptPaths,
  insertBackfilledSession,
  updateSessionData,
} from '../db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function backfillCheck(weeksBack: number) {
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

    const encodedPath = sanitizeName(t.cwd)
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
}

export async function backfillRun(
  encodedPath: string,
  cwd: string,
  terminalId: number,
  shellId: number,
  weeksBack: number,
) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects', encodedPath)

  let allFiles: string[]
  try {
    const entries = await fs.promises.readdir(claudeDir)
    allFiles = entries.filter((f) => f.endsWith('.jsonl'))
  } catch {
    throw new Error('Claude project directory not found')
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
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..')
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
}

/** Check if a JSONL file is a real session (reads first 64KB for user/assistant type). */
async function isRealSession(filePath: string) {
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

/** Read the last timestamp from a JSONL file. */
async function readLastTimestamp(filePath: string) {
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

/** Extract all unique gitBranch values from a JSONL file. */
async function readSessionBranches(filePath: string) {
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
    return { branch: null, allBranches: [] as string[] }
  }
}
