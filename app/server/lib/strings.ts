import os from 'node:os'
import path from 'node:path'

/** Shell-escape a string for safe embedding in SSH commands. */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Sanitize a name for use as a zellij session name or file-safe identifier. */
export function sanitizeName(s: string): string {
  return s.replace(/[/ ]/g, '-')
}

/** Expand ~ to home directory. */
export function expandPath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  if (p === '~') return os.homedir()
  return p
}
