import { execFileAsync } from '@server/lib/exec'
import type { ChangedFile, FileStatus } from '../schema'

// --- Fetch cache ---

const fetchCache = new Map<string, number>()

export async function fetchOriginIfNeeded(
  cwd: string,
  refspecs: string[],
  ttlMs = 30000,
) {
  const key = `${cwd}\0${[...refspecs].sort().join('\0')}`
  const last = fetchCache.get(key)
  if (last && Date.now() - last < ttlMs) {
    return
  }
  try {
    await execFileAsync('git', ['fetch', 'origin', ...refspecs], {
      cwd,
      timeout: 30000,
    })
  } catch {
    // fetch failure is non-fatal
  } finally {
    fetchCache.set(key, Date.now())
  }
}

// --- Parsing helpers ---

export function parseUntrackedWc(wcOut: string) {
  const map = new Map<string, number>()
  for (const line of wcOut.trim().split('\n')) {
    if (!line) continue
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (match && match[2] !== 'total') {
      map.set(match[2], Number(match[1]) || 0)
    }
  }
  return map
}

export function parseChangedFiles(
  numstatOut: string,
  nameStatusOut: string,
  untrackedOut: string,
  untrackedWcOut?: string,
) {
  // Parse --numstat: <added>\t<removed>\t<path>
  const numstatMap = new Map<string, { added: number; removed: number }>()
  for (const line of numstatOut.trim().split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const added = parts[0] === '-' ? 0 : Number(parts[0]) || 0
    const removed = parts[1] === '-' ? 0 : Number(parts[1]) || 0
    const filePath = parts.slice(2).join('\t')
    numstatMap.set(filePath, { added, removed })
  }

  // Parse --name-status: <status>\t<path>
  const statusMap = new Map<string, { status: FileStatus; oldPath?: string }>()
  for (const line of nameStatusOut.trim().split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const code = parts[0]
    if (code.startsWith('R')) {
      statusMap.set(parts[2], { status: 'renamed', oldPath: parts[1] })
    } else {
      const status: FileStatus =
        code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
      statusMap.set(parts[1], { status })
    }
  }

  const files: ChangedFile[] = []

  for (const [filePath, { status, oldPath }] of statusMap) {
    const numstatKey =
      status === 'renamed' && oldPath ? `${oldPath} => ${filePath}` : filePath
    const stats = numstatMap.get(numstatKey) ??
      numstatMap.get(filePath) ?? { added: 0, removed: 0 }
    files.push({
      path: filePath,
      status,
      added: stats.added,
      removed: stats.removed,
      ...(oldPath && { oldPath }),
    })
  }

  // Untracked files
  const untrackedWcMap = untrackedWcOut
    ? parseUntrackedWc(untrackedWcOut)
    : undefined
  for (const line of untrackedOut.trim().split('\n')) {
    if (!line) continue
    if (!statusMap.has(line)) {
      const added = untrackedWcMap?.get(line) ?? 0
      files.push({ path: line, status: 'untracked', added, removed: 0 })
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}
