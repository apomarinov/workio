import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { ClaudeIcon } from '@/components/icons'
import { cn, sessionStatusColor } from '@/lib/utils'

export function SessionSearchIcon({ status }: { status: string }) {
  if (status === 'done')
    return <Check className="h-4 w-4 shrink-0 text-green-500/70" />
  return (
    <ClaudeIcon
      className={cn(
        'h-4 w-4 shrink-0',
        sessionStatusColor[status] ?? 'text-gray-400',
      )}
    />
  )
}

export function contextExcerpt(
  text: string,
  query: string,
  maxLen = 200,
): string {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lowerText.indexOf(lowerQuery)
  if (idx === -1) {
    // No match found, return start of text
    if (text.length <= maxLen) return text
    return `${text.slice(0, maxLen)}...`
  }
  // Center the window around the match
  const remaining = maxLen - query.length
  let start = Math.max(0, idx - Math.floor(remaining / 2))
  const end = Math.min(text.length, start + maxLen)
  // Adjust start if end hit the boundary
  if (end - start < maxLen) {
    start = Math.max(0, end - maxLen)
  }
  const excerpt = text.slice(start, end)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${excerpt}${suffix}`
}

export function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts: ReactNode[] = []
  let lastIndex = 0
  let i = lowerText.indexOf(lowerQuery, lastIndex)
  while (i !== -1) {
    if (i > lastIndex) {
      parts.push(text.slice(lastIndex, i))
    }
    parts.push(
      <span key={i} className="font-semibold text-amber-400">
        {text.slice(i, i + query.length)}
      </span>,
    )
    lastIndex = i + query.length
    i = lowerText.indexOf(lowerQuery, lastIndex)
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  // biome-ignore lint/complexity/noUselessFragments: needed to return JSX array
  return parts.length === 1 ? parts[0] : <>{parts}</>
}
