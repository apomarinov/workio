export interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffHunk {
  lineIndex: number
}

export interface ParsedDiff {
  lines: DiffLine[]
  hunks: DiffHunk[]
}

export function parseDiff(raw: string): ParsedDiff {
  const lines: DiffLine[] = []
  const hunks: DiffHunk[] = []

  if (!raw.trim()) return { lines, hunks }

  const rawLines = raw.split('\n')
  let oldLine = 0
  let newLine = 0

  for (const line of rawLines) {
    // Skip diff header lines
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue
    }

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10)
      newLine = parseInt(hunkMatch[2], 10)
      hunks.push({ lineIndex: lines.length })
      lines.push({
        type: 'header',
        content: line,
        oldLineNumber: null,
        newLineNumber: null,
      })
      continue
    }

    if (line.startsWith('+')) {
      lines.push({
        type: 'added',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine++,
      })
    } else if (line.startsWith('-')) {
      lines.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: null,
      })
    } else if (line.startsWith(' ') || line === '') {
      // Context line (or empty trailing line)
      const content = line.startsWith(' ') ? line.slice(1) : line
      // Only add if we're inside a hunk (oldLine/newLine > 0)
      if (oldLine > 0 || newLine > 0) {
        lines.push({
          type: 'context',
          content,
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        })
      }
    } else if (line.startsWith('\\')) {
    } else if (line.startsWith('Binary files')) {
      lines.push({
        type: 'header',
        content: line,
        oldLineNumber: null,
        newLineNumber: null,
      })
    }
  }

  return { lines, hunks }
}
