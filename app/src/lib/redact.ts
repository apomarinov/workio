/**
 * Demo-mode redaction: replace sensitive words in terminal output and DOM text.
 * Add your replacements here before recording product videos.
 */

const REPLACEMENTS: [string, string][] = []

// Build a single regex from all replacement keys (case-insensitive)
let _regex: RegExp | null = null
let _map: Map<string, string> | null = null

function ensureCompiled() {
  if (_regex) return
  _map = new Map(REPLACEMENTS.map(([k, v]) => [k.toLowerCase(), v]))
  if (REPLACEMENTS.length === 0) {
    _regex = null
    return
  }
  const escaped = REPLACEMENTS.map(([k]) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  _regex = new RegExp(escaped.join('|'), 'gi')
}

export function redactText(text: string): string {
  if (REPLACEMENTS.length === 0) return text
  ensureCompiled()
  if (!_regex) return text
  return text.replace(
    _regex,
    (match) => _map!.get(match.toLowerCase()) ?? match,
  )
}

export function isRedactionEnabled(): boolean {
  return REPLACEMENTS.length > 0
}
