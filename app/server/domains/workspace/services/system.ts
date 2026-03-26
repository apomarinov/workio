import { execFileAsyncLogged } from '@server/lib/exec'

// Walk up the process tree to find the parent macOS .app (e.g. Terminal, iTerm2, VS Code)
async function getParentAppName() {
  if (process.platform !== 'darwin') return null
  try {
    let pid = process.ppid
    while (pid > 1) {
      const { stdout: comm } = await execFileAsyncLogged(
        'ps',
        ['-o', 'comm=', '-p', String(pid)],
        { category: 'workspace', errorOnly: true, encoding: 'utf-8' },
      )
      const match = comm.trim().match(/\/([^/]+)\.app\//)
      if (match) return match[1]
      const { stdout: ppidStr } = await execFileAsyncLogged(
        'ps',
        ['-o', 'ppid=', '-p', String(pid)],
        { category: 'workspace', errorOnly: true, encoding: 'utf-8' },
      )
      pid = Number.parseInt(ppidStr.trim(), 10)
      if (Number.isNaN(pid)) break
    }
  } catch {}
  return null
}

// Lazily cached parent app name
let parentAppNamePromise: Promise<string | null> | null = null
export function getParentAppNameCached() {
  if (!parentAppNamePromise) {
    parentAppNamePromise = getParentAppName()
  }
  return parentAppNamePromise
}
