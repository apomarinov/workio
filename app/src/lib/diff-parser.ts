export interface WordSegment {
  text: string
  highlight: boolean
}

export interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
  segments?: WordSegment[]
}

export interface DiffHunk {
  lineIndex: number
}

export interface ParsedDiff {
  lines: DiffLine[]
  hunks: DiffHunk[]
}

/** Split a string into word-level tokens (words + whitespace/punctuation kept separate) */
function tokenize(s: string): string[] {
  return s.match(/\S+|\s+/g) || []
}

/**
 * Compute longest common subsequence length table for two token arrays.
 * Returns a 2D array where lcs[i][j] = LCS length of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/** Compute word-diff segments for a pair of removed/added lines */
function computeWordSegments(
  removedContent: string,
  addedContent: string,
): { removedSegments: WordSegment[]; addedSegments: WordSegment[] } {
  const aTokens = tokenize(removedContent)
  const bTokens = tokenize(addedContent)

  // If lines are too different, don't bother with word diff
  const dp = lcsTable(aTokens, bTokens)
  const lcsLen = dp[aTokens.length][bTokens.length]
  const maxLen = Math.max(aTokens.length, bTokens.length)
  if (maxLen > 0 && lcsLen / maxLen < 0.3) {
    // Less than 30% common — treat as entirely different
    return {
      removedSegments: [{ text: removedContent, highlight: false }],
      addedSegments: [{ text: addedContent, highlight: false }],
    }
  }

  // Backtrack for removed line (a is the primary)
  const removedSegments: WordSegment[] = []
  const addedSegments: WordSegment[] = []

  // Walk the DP table to produce segments for both sides
  let i = aTokens.length
  let j = bTokens.length
  const aHighlight: boolean[] = new Array(aTokens.length).fill(true)
  const bHighlight: boolean[] = new Array(bTokens.length).fill(true)

  while (i > 0 && j > 0) {
    if (aTokens[i - 1] === bTokens[j - 1]) {
      aHighlight[i - 1] = false
      bHighlight[j - 1] = false
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  // Build merged segments for removed
  for (let k = 0; k < aTokens.length; k++) {
    const hl = aHighlight[k]
    if (
      removedSegments.length > 0 &&
      removedSegments[removedSegments.length - 1].highlight === hl
    ) {
      removedSegments[removedSegments.length - 1].text += aTokens[k]
    } else {
      removedSegments.push({ text: aTokens[k], highlight: hl })
    }
  }

  // Build merged segments for added
  for (let k = 0; k < bTokens.length; k++) {
    const hl = bHighlight[k]
    if (
      addedSegments.length > 0 &&
      addedSegments[addedSegments.length - 1].highlight === hl
    ) {
      addedSegments[addedSegments.length - 1].text += bTokens[k]
    } else {
      addedSegments.push({ text: bTokens[k], highlight: hl })
    }
  }

  return { removedSegments, addedSegments }
}

/** Post-process parsed lines to add word-diff segments for paired -/+ lines */
function addWordDiffSegments(lines: DiffLine[]): void {
  let i = 0
  while (i < lines.length) {
    // Find a block of consecutive removed lines followed by consecutive added lines
    if (lines[i].type === 'removed') {
      const removeStart = i
      while (i < lines.length && lines[i].type === 'removed') i++
      const removeEnd = i

      const addStart = i
      while (i < lines.length && lines[i].type === 'added') i++
      const addEnd = i

      // Pair up removed/added lines (min of the two counts)
      const pairs = Math.min(removeEnd - removeStart, addEnd - addStart)
      for (let p = 0; p < pairs; p++) {
        const removed = lines[removeStart + p]
        const added = lines[addStart + p]
        const { removedSegments, addedSegments } = computeWordSegments(
          removed.content,
          added.content,
        )
        removed.segments = removedSegments
        added.segments = addedSegments
      }
    } else {
      i++
    }
  }
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
        content: hunkMatch[3].trim() || '',
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

  addWordDiffSegments(lines)

  return { lines, hunks }
}
