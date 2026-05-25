import fs from 'node:fs'
import { log } from '@server/logger'

// Resolving bare command names (e.g. 'ps', 'lsof') to absolute paths
// avoids a kernel-level $PATH walk on every execFile. Each missing-
// directory probe is logged by macOS AppleSystemPolicy and contributes
// to the exec-event refcount leak — see KERNEL_PANIC_INVESTIGATION.md.

// Common system dirs to probe even if absent from $PATH (e.g. /usr/sbin
// for lsof on macOS, /opt/homebrew/bin on Apple Silicon).
const FALLBACK_DIRS = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
]

const cache = new Map<string, string>()

function findInPath(name: string): string | null {
  const fromEnv = (process.env.PATH || '').split(':').filter(Boolean)
  const seen = new Set<string>()
  const dirs = [...fromEnv, ...FALLBACK_DIRS].filter((d) => {
    if (seen.has(d)) return false
    seen.add(d)
    return true
  })
  for (const dir of dirs) {
    const candidate = `${dir}/${name}`
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}

/**
 * Resolve a command name to an absolute path. Bare names are looked up in
 * $PATH (plus a fallback dir list) and memoized for the process lifetime.
 * Paths containing '/' are returned as-is. Unresolvable names fall back to
 * the bare name so execFile still has a chance to find them.
 */
export function resolveTool(name: string): string {
  if (!name || name.includes('/')) return name
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  const resolved = findInPath(name) ?? name
  cache.set(name, resolved)
  return resolved
}

// Pre-warm cache for tools used in tight polling loops so the first call
// doesn't pay the lookup cost and we get visibility via the startup log.
const PRELOAD = [
  'ps',
  'lsof',
  'pgrep',
  'zellij',
  'memory_pressure',
  'sh',
  'awk',
]

export async function initToolPaths() {
  for (const name of PRELOAD) {
    const resolved = findInPath(name)
    cache.set(name, resolved ?? name)
    if (!resolved) {
      log.warn(`[tool-paths] '${name}' not found in $PATH; using bare name`)
    }
  }
  log.info(
    `[tool-paths] ${PRELOAD.map((n) => `${n}=${cache.get(n)}`).join(' ')}`,
  )
}
