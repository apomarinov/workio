import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Maximize2,
  WrapText,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark as oneDarkBase } from 'react-syntax-highlighter/dist/esm/styles/prism'

const oneDark: typeof oneDarkBase = {
  ...oneDarkBase,
  'pre[class*="language-"]': {
    ...oneDarkBase['pre[class*="language-"]'],
    background: 'transparent',
  },
  'code[class*="language-"]': {
    ...oneDarkBase['code[class*="language-"]'],
    background: 'transparent',
  },
}

import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getFileDiff, openInIDE } from '@/lib/api'
import type { DiffLine, ParsedDiff } from '@/lib/diff-parser'
import { parseDiff } from '@/lib/diff-parser'
import { cn } from '@/lib/utils'

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
}

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_LANGUAGE[ext] || 'text'
}

const DIFF_BG = {
  added: 'rgba(34, 197, 94, 0.12)',
  removed: 'rgba(239, 68, 68, 0.12)',
  header: 'rgba(96, 165, 250, 0.08)',
} as const

const WORD_HIGHLIGHT_BG = {
  added: 'rgba(34, 197, 94, 0.3)',
  removed: 'rgba(239, 68, 68, 0.3)',
} as const

const LINE_NUM_COLOR = {
  added: 'rgba(34, 197, 94, 0.5)',
  removed: 'rgba(239, 68, 68, 0.5)',
} as const

const HIGHLIGHT_BORDER = {
  added: 'rgba(34, 197, 94, 0.5)',
  removed: 'rgba(239, 68, 68, 0.5)',
  mixed: 'rgba(96, 165, 250, 0.5)',
} as const

/** Find the range of changed (non-context, non-header) lines for a hunk */
function getHunkChangedRange(
  lines: DiffLine[],
  hunkStartIndex: number,
  nextHunkStartIndex: number | undefined,
): { first: number; last: number } | null {
  const end = nextHunkStartIndex ?? lines.length
  let first = -1
  let last = -1
  for (let i = hunkStartIndex; i < end; i++) {
    const t = lines[i].type
    if (t === 'added' || t === 'removed') {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return null
  return { first, last }
}

function getLineNumber(line: DiffLine): number | null {
  return line.newLineNumber ?? line.oldLineNumber
}

interface FileDiffViewerProps {
  terminalId: number
  filePath: string | null
  preferredIde: 'cursor' | 'vscode'
}

export function FileDiffViewer({
  terminalId,
  filePath,
  preferredIde,
}: FileDiffViewerProps) {
  const [showFullFile, setShowFullFile] = useState(false)
  const [wordWrap, setWordWrap] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0)
  const [highlightedHunkIndex, setHighlightedHunkIndex] = useState<
    number | null
  >(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const swrKey =
    filePath != null ? ['file-diff', terminalId, filePath, showFullFile] : null

  const {
    data: parsed,
    isLoading,
    error,
  } = useSWR(
    swrKey,
    async ([, tid, fp, full]) => {
      const { diff } = await getFileDiff(
        tid as number,
        fp as string,
        full as boolean,
      )
      return parseDiff(diff)
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  // Precompute hunk line index map: lineIndex -> hunkIndex
  const hunkIndexMap = new Map<number, number>()
  if (parsed) {
    for (let hi = 0; hi < parsed.hunks.length; hi++) {
      hunkIndexMap.set(parsed.hunks[hi].lineIndex, hi)
    }
  }

  const virtualizer = useVirtualizer({
    count: parsed?.lines.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 200,
  })

  // Re-measure all rows when word wrap changes
  useEffect(() => {
    virtualizer.measure()
  }, [wordWrap, virtualizer])

  const navigateHunk = (direction: 'prev' | 'next') => {
    if (!parsed || parsed.hunks.length === 0) return
    const nextIndex =
      direction === 'prev'
        ? Math.max(0, currentHunkIndex - 1)
        : Math.min(parsed.hunks.length - 1, currentHunkIndex + 1)
    setCurrentHunkIndex(nextIndex)
    setHighlightedHunkIndex(nextIndex)
    const hunkLineIndex = parsed.hunks[nextIndex].lineIndex
    virtualizer.scrollToIndex(hunkLineIndex, {
      align: 'start',
      behavior: 'smooth',
    })
  }

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Select a file to view changes
      </div>
    )
  }

  if (isLoading && !parsed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading diff...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-400">
        {error instanceof Error ? error.message : 'Failed to load diff'}
      </div>
    )
  }

  if (!parsed || parsed.lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No changes
      </div>
    )
  }

  const language = getLanguage(filePath)
  const isBinary = parsed.lines.some(
    (l) => l.type === 'header' && l.content.startsWith('Binary files'),
  )

  if (isBinary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Binary file — cannot display diff
      </div>
    )
  }

  // Precompute highlighted hunk range
  let highlightRange: {
    first: number
    last: number
    borderColor: string
  } | null = null
  if (highlightedHunkIndex != null && parsed.hunks[highlightedHunkIndex]) {
    const hunk = parsed.hunks[highlightedHunkIndex]
    const nextHunk = parsed.hunks[highlightedHunkIndex + 1]
    const range = getHunkChangedRange(
      parsed.lines,
      hunk.lineIndex,
      nextHunk?.lineIndex,
    )
    if (range) {
      // Determine border color from change types in range
      let hasAdded = false
      let hasRemoved = false
      for (let i = range.first; i <= range.last; i++) {
        if (parsed.lines[i].type === 'added') hasAdded = true
        if (parsed.lines[i].type === 'removed') hasRemoved = true
      }
      const borderColor =
        hasAdded && hasRemoved
          ? HIGHLIGHT_BORDER.mixed
          : hasAdded
            ? HIGHLIGHT_BORDER.added
            : HIGHLIGHT_BORDER.removed
      highlightRange = { ...range, borderColor }
    }
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <>
      <div
        className="flex flex-1 flex-col min-h-0 overflow-hidden"
        onClick={() => setHighlightedHunkIndex(null)}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b border-zinc-700 px-2 py-1 flex-shrink-0">
          <span className="truncate text-xs text-zinc-500 mr-auto">
            {filePath}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation()
              setShowFullFile(!showFullFile)
              setCurrentHunkIndex(0)
              setHighlightedHunkIndex(null)
            }}
            title={showFullFile ? 'Compact view' : 'Full file'}
          >
            {showFullFile ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation()
              navigateHunk('prev')
            }}
            disabled={parsed.hunks.length === 0 || currentHunkIndex === 0}
            title="Previous change"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation()
              navigateHunk('next')
            }}
            disabled={
              parsed.hunks.length === 0 ||
              currentHunkIndex >= parsed.hunks.length - 1
            }
            title="Next change"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7', wordWrap && 'bg-zinc-700')}
            onClick={(e) => {
              e.stopPropagation()
              setWordWrap(!wordWrap)
            }}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          >
            <WrapText className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation()
              openInIDE(filePath, preferredIde, terminalId).catch(() => {})
            }}
            title={`Open in ${preferredIde === 'cursor' ? 'Cursor' : 'VS Code'}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation()
              setMaximized(true)
            }}
            title="Maximize"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Diff content */}
        <div ref={scrollRef} className="flex-1 overflow-auto min-h-0">
          <style>{`
          .diff-line-added:hover { background-color: rgba(34, 197, 94, 0.18) !important }
          .diff-line-removed:hover { background-color: rgba(239, 68, 68, 0.18) !important }
          .diff-line-context:hover { background-color: rgba(255, 255, 255, 0.04) !important }
          .diff-line-header:hover { background-color: rgba(96, 165, 250, 0.12) !important }
          .diff-wrap-content, .diff-wrap-content * { white-space: pre-wrap !important; word-break: break-all !important; overflow-wrap: break-word !important; }
        `}</style>
          <div
            className={cn(
              'text-xs leading-5 font-mono relative',
              wordWrap ? 'w-full' : 'w-max min-w-full',
            )}
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const i = virtualRow.index
              const line = parsed.lines[i]
              const hunkIdx = hunkIndexMap.get(i)
              const bg = DIFF_BG[line.type as keyof typeof DIFF_BG]

              // Highlight borders
              const isFirst = highlightRange?.first === i
              const isLast = highlightRange?.last === i
              const isInRange =
                highlightRange != null &&
                i >= highlightRange.first &&
                i <= highlightRange.last

              const borderStyle: React.CSSProperties = {}
              if (isFirst && highlightRange) {
                borderStyle.borderTop = `1px solid ${highlightRange.borderColor}`
              }
              if (isLast && highlightRange) {
                borderStyle.borderBottom = `1px solid ${highlightRange.borderColor}`
              }
              if (isInRange && highlightRange) {
                borderStyle.borderLeft = `2px solid ${highlightRange.borderColor}`
                borderStyle.borderRight = `1px solid ${highlightRange.borderColor}`
              }

              const lineNum = getLineNumber(line)

              return (
                <div
                  key={virtualRow.key}
                  data-index={i}
                  data-hunk-index={hunkIdx != null ? hunkIdx : undefined}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'group/line flex absolute top-0 left-0 w-full',
                    `diff-line-${line.type}`,
                  )}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    ...(bg ? { backgroundColor: bg } : {}),
                    ...borderStyle,
                  }}
                >
                  <div
                    className="relative select-none text-right px-1.5 w-10 shrink-0 align-top"
                    style={{
                      color:
                        LINE_NUM_COLOR[
                          line.type as keyof typeof LINE_NUM_COLOR
                        ] ?? 'rgb(113, 113, 122)',
                    }}
                  >
                    <span className="group-hover/line:invisible">
                      {line.oldLineNumber ?? ''}
                    </span>
                    {lineNum != null && (
                      <button
                        type="button"
                        className="absolute cursor-pointer inset-0 hidden group-hover/line:inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300"
                        title={`Open at line ${lineNum}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openInIDE(
                            `${filePath}:${lineNum}`,
                            preferredIde,
                            terminalId,
                          ).catch(() => {})
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div
                    className="select-none text-right px-1.5 w-10 shrink-0 border-r border-zinc-700/50 align-top"
                    style={{
                      color:
                        LINE_NUM_COLOR[
                          line.type as keyof typeof LINE_NUM_COLOR
                        ] ?? 'rgb(113, 113, 122)',
                    }}
                  >
                    {line.newLineNumber ?? ''}
                  </div>
                  <div
                    className={cn(
                      'pl-2 min-w-0 flex-1',
                      wordWrap ? 'diff-wrap-content' : 'whitespace-pre',
                    )}
                  >
                    {line.type === 'removed' ? (
                      <span className="text-zinc-400">
                        {line.segments?.some((s) => s.highlight)
                          ? line.segments.map((seg, si) => (
                              <span
                                key={`${si}-${seg.highlight}`}
                                style={
                                  seg.highlight
                                    ? {
                                        backgroundColor:
                                          WORD_HIGHLIGHT_BG.removed,
                                        borderRadius: '2px',
                                      }
                                    : undefined
                                }
                              >
                                {seg.text}
                              </span>
                            ))
                          : line.content || ' '}
                      </span>
                    ) : (
                      <SyntaxHighlighter
                        language={language}
                        style={oneDark}
                        customStyle={{
                          margin: 0,
                          padding: 0,
                          background: 'transparent',
                          fontSize: 'inherit',
                          lineHeight: 'inherit',
                          display: 'inline',
                        }}
                        PreTag="span"
                        CodeTag="span"
                      >
                        {line.content || ' '}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <Dialog open={maximized} onOpenChange={setMaximized}>
        <DialogContent
          className="w-[95vw] sm:max-w-[95vw] h-[95vh] max-h-[95vh] flex flex-col overflow-hidden p-0"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="hidden">
            <DialogTitle>{filePath}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <MaximizedDiffContent
              terminalId={terminalId}
              filePath={filePath}
              preferredIde={preferredIde}
              parsed={parsed}
              language={language}
              onClose={() => setMaximized(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function MaximizedDiffContent({
  terminalId,
  filePath,
  preferredIde,
  parsed,
  language,
  onClose,
}: {
  terminalId: number
  filePath: string
  preferredIde: 'cursor' | 'vscode'
  parsed: ParsedDiff
  language: string
  onClose: () => void
}) {
  const [wordWrap, setWordWrap] = useState(true)
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0)
  const [highlightedHunkIndex, setHighlightedHunkIndex] = useState<
    number | null
  >(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const hunkIndexMap = new Map<number, number>()
  for (let hi = 0; hi < parsed.hunks.length; hi++) {
    hunkIndexMap.set(parsed.hunks[hi].lineIndex, hi)
  }

  const virtualizer = useVirtualizer({
    count: parsed.lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 200,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [wordWrap, virtualizer])

  const navigateHunk = (direction: 'prev' | 'next') => {
    if (parsed.hunks.length === 0) return
    const nextIndex =
      direction === 'prev'
        ? Math.max(0, currentHunkIndex - 1)
        : Math.min(parsed.hunks.length - 1, currentHunkIndex + 1)
    setCurrentHunkIndex(nextIndex)
    setHighlightedHunkIndex(nextIndex)
    virtualizer.scrollToIndex(parsed.hunks[nextIndex].lineIndex, {
      align: 'start',
      behavior: 'smooth',
    })
  }

  let highlightRange: {
    first: number
    last: number
    borderColor: string
  } | null = null
  if (highlightedHunkIndex != null && parsed.hunks[highlightedHunkIndex]) {
    const hunk = parsed.hunks[highlightedHunkIndex]
    const nextHunk = parsed.hunks[highlightedHunkIndex + 1]
    const range = getHunkChangedRange(
      parsed.lines,
      hunk.lineIndex,
      nextHunk?.lineIndex,
    )
    if (range) {
      let hasAdded = false
      let hasRemoved = false
      for (let i = range.first; i <= range.last; i++) {
        if (parsed.lines[i].type === 'added') hasAdded = true
        if (parsed.lines[i].type === 'removed') hasRemoved = true
      }
      const borderColor =
        hasAdded && hasRemoved
          ? HIGHLIGHT_BORDER.mixed
          : hasAdded
            ? HIGHLIGHT_BORDER.added
            : HIGHLIGHT_BORDER.removed
      highlightRange = { ...range, borderColor }
    }
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      className="flex flex-1 flex-col min-h-0 h-full overflow-hidden"
      onClick={() => setHighlightedHunkIndex(null)}
    >
      <div className="flex items-center gap-1 border-b border-zinc-700 px-2 py-1 flex-shrink-0">
        <span className="truncate text-xs text-zinc-500 mr-auto">
          {filePath}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation()
            navigateHunk('prev')
          }}
          disabled={parsed.hunks.length === 0 || currentHunkIndex === 0}
          title="Previous change"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation()
            navigateHunk('next')
          }}
          disabled={
            parsed.hunks.length === 0 ||
            currentHunkIndex >= parsed.hunks.length - 1
          }
          title="Next change"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', wordWrap && 'bg-zinc-700')}
          onClick={(e) => {
            e.stopPropagation()
            setWordWrap(!wordWrap)
          }}
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        >
          <WrapText className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation()
            openInIDE(filePath, preferredIde, terminalId).catch(() => {})
          }}
          title={`Open in ${preferredIde === 'cursor' ? 'Cursor' : 'VS Code'}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto min-h-0">
        <style>{`
          .diff-line-added:hover { background-color: rgba(34, 197, 94, 0.18) !important }
          .diff-line-removed:hover { background-color: rgba(239, 68, 68, 0.18) !important }
          .diff-line-context:hover { background-color: rgba(255, 255, 255, 0.04) !important }
          .diff-line-header:hover { background-color: rgba(96, 165, 250, 0.12) !important }
          .diff-wrap-content, .diff-wrap-content * { white-space: pre-wrap !important; word-break: break-all !important; overflow-wrap: break-word !important; }
        `}</style>
        <div
          className={cn(
            'text-xs leading-5 font-mono relative',
            wordWrap ? 'w-full' : 'w-max min-w-full',
          )}
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualRow) => {
            const i = virtualRow.index
            const line = parsed.lines[i]
            const hunkIdx = hunkIndexMap.get(i)
            const bg = DIFF_BG[line.type as keyof typeof DIFF_BG]

            const isFirst = highlightRange?.first === i
            const isLast = highlightRange?.last === i
            const isInRange =
              highlightRange != null &&
              i >= highlightRange.first &&
              i <= highlightRange.last

            const borderStyle: React.CSSProperties = {}
            if (isFirst && highlightRange) {
              borderStyle.borderTop = `1px solid ${highlightRange.borderColor}`
            }
            if (isLast && highlightRange) {
              borderStyle.borderBottom = `1px solid ${highlightRange.borderColor}`
            }
            if (isInRange && highlightRange) {
              borderStyle.borderLeft = `2px solid ${highlightRange.borderColor}`
              borderStyle.borderRight = `1px solid ${highlightRange.borderColor}`
            }

            const lineNum = getLineNumber(line)

            return (
              <div
                key={virtualRow.key}
                data-index={i}
                data-hunk-index={hunkIdx != null ? hunkIdx : undefined}
                ref={virtualizer.measureElement}
                className={cn(
                  'group/line flex absolute top-0 left-0 w-full',
                  `diff-line-${line.type}`,
                )}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  ...(bg ? { backgroundColor: bg } : {}),
                  ...borderStyle,
                }}
              >
                <div
                  className="relative select-none text-right px-1.5 w-10 shrink-0 align-top"
                  style={{
                    color:
                      LINE_NUM_COLOR[
                        line.type as keyof typeof LINE_NUM_COLOR
                      ] ?? 'rgb(113, 113, 122)',
                  }}
                >
                  <span className="group-hover/line:invisible">
                    {line.oldLineNumber ?? ''}
                  </span>
                  {lineNum != null && (
                    <button
                      type="button"
                      className="absolute cursor-pointer inset-0 hidden group-hover/line:inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300"
                      title={`Open at line ${lineNum}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openInIDE(
                          `${filePath}:${lineNum}`,
                          preferredIde,
                          terminalId,
                        ).catch(() => {})
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div
                  className="select-none text-right px-1.5 w-10 shrink-0 border-r border-zinc-700/50 align-top"
                  style={{
                    color:
                      LINE_NUM_COLOR[
                        line.type as keyof typeof LINE_NUM_COLOR
                      ] ?? 'rgb(113, 113, 122)',
                  }}
                >
                  {line.newLineNumber ?? ''}
                </div>
                <div
                  className={cn(
                    'pl-2 min-w-0 flex-1',
                    wordWrap ? 'diff-wrap-content' : 'whitespace-pre',
                  )}
                >
                  {line.type === 'removed' ? (
                    <span className="text-zinc-400">
                      {line.segments?.some((s) => s.highlight)
                        ? line.segments.map((seg, si) => (
                            <span
                              key={`${si}-${seg.highlight}`}
                              style={
                                seg.highlight
                                  ? {
                                      backgroundColor:
                                        WORD_HIGHLIGHT_BG.removed,
                                      borderRadius: '2px',
                                    }
                                  : undefined
                              }
                            >
                              {seg.text}
                            </span>
                          ))
                        : line.content || ' '}
                    </span>
                  ) : (
                    <SyntaxHighlighter
                      language={language}
                      style={oneDark}
                      customStyle={{
                        margin: 0,
                        padding: 0,
                        background: 'transparent',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                        display: 'inline',
                      }}
                      PreTag="span"
                      CodeTag="span"
                    >
                      {line.content || ' '}
                    </SyntaxHighlighter>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
