/** Compact elapsed time from a unix-ms timestamp: `<1m`, `3m`, `2h`, `1d` */
function formatElapsed(timestampMs: number): string {
  const minutes = Math.floor((Date.now() - timestampMs) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Human-readable "X ago" from a date string or unix-ms timestamp: `just now`, `3m ago`, `2h ago`, `1d ago` */
export function formatTimeAgo(date: string | number): string {
  const ms = typeof date === 'number' ? date : new Date(date).getTime()
  const elapsed = formatElapsed(ms)
  return elapsed === '<1m' ? 'just now' : `${elapsed} ago`
}
