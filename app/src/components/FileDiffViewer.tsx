import { ColorSchemeType } from 'diff2html/lib-esm/types'
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui'
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Maximize2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { getFileDiff, openInIDE } from '@/lib/api'

const D2H_CONFIG = {
  outputFormat: 'line-by-line' as const,
  drawFileList: false,
  matching: 'words' as const,
  diffStyle: 'word' as const,
  colorScheme: ColorSchemeType.DARK,
  highlight: true,
  stickyFileHeaders: false,
  fileContentToggle: false,
  fileListToggle: false,
  smartSelection: true,
}

/** Inner component that renders diff via Diff2HtmlUI into a DOM ref */
function DiffContent({
  diffString,
  currentHunkIndex,
  filePath,
  preferredIde,
  terminalId,
}: {
  diffString: string
  currentHunkIndex: number
  filePath: string
  preferredIde: 'cursor' | 'vscode'
  terminalId: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevDiffRef = useRef<string>('')

  // Render diff2html when diffString changes
  useEffect(() => {
    const el = containerRef.current
    if (!el || !diffString) return
    if (diffString === prevDiffRef.current) return
    prevDiffRef.current = diffString

    const ui = new Diff2HtmlUI(el, diffString, D2H_CONFIG)
    ui.draw()
    ui.highlightCode()
  }, [diffString])

  // Hunk navigation via DOM query + scrollIntoView
  const prevHunkRef = useRef(-1)
  useEffect(() => {
    const el = containerRef.current
    if (!el || currentHunkIndex < 0) return
    if (currentHunkIndex === prevHunkRef.current) return
    prevHunkRef.current = currentHunkIndex

    const hunkRows = el.querySelectorAll('.d2h-info')
    if (hunkRows[currentHunkIndex]) {
      hunkRows[currentHunkIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }, [currentHunkIndex])

  // Line number hover: inject open-in-IDE button on row hover
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let activeBtn: HTMLButtonElement | null = null
    let activeRow: HTMLElement | null = null
    let hiddenNums: HTMLElement[] = []

    const cleanup = () => {
      if (activeBtn) {
        activeBtn.remove()
        activeBtn = null
      }
      for (const el of hiddenNums) el.style.visibility = ''
      hiddenNums = []
      activeRow = null
    }

    const onOver = (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest('tr')
      if (!row || row === activeRow) return
      cleanup()
      activeRow = row

      const cell = row.querySelector('.d2h-code-linenumber') as HTMLElement
      if (!cell) return
      const num2 = cell.querySelector('.line-num2') as HTMLElement
      const lineText = num2?.textContent?.trim()
      if (!lineText) return
      const lineNum = Number.parseInt(lineText, 10)
      if (Number.isNaN(lineNum)) return

      // Hide line numbers
      const nums = cell.querySelectorAll<HTMLElement>('.line-num1, .line-num2')
      for (const n of nums) {
        n.style.visibility = 'hidden'
        hiddenNums.push(n)
      }

      const btn = document.createElement('button')
      btn.className = 'diff-line-open-btn'
      btn.title = `Open at line ${lineNum}`
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
      btn.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        openInIDE(`${filePath}:${lineNum}`, preferredIde, terminalId).catch(
          (err) =>
            toast.error(
              err instanceof Error ? err.message : 'Failed to open in IDE',
            ),
        )
      })
      cell.appendChild(btn)
      activeBtn = btn
    }

    const onLeave = () => cleanup()

    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseleave', onLeave)
      cleanup()
    }
  }, [filePath, preferredIde, terminalId])

  return <div ref={containerRef} className="diff-viewer-content" />
}

interface FileDiffViewerProps {
  terminalId: number
  filePath: string | null
  preferredIde: 'cursor' | 'vscode'
  base?: string
}

export function FileDiffViewer({
  terminalId,
  filePath,
  preferredIde,
  base,
}: FileDiffViewerProps) {
  const [showFullFile, setShowFullFile] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0)
  const hunkCountRef = useRef(0)

  const swrKey =
    filePath != null
      ? ['file-diff', terminalId, filePath, showFullFile, base ?? null]
      : null

  const {
    data: diffString,
    isLoading,
    error,
  } = useSWR(
    swrKey,
    async ([, tid, fp, full, b]) => {
      const { diff } = await getFileDiff(
        tid as number,
        fp as string,
        full as boolean,
        (b as string) ?? undefined,
      )
      return diff
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  // Count hunks in raw diff for navigation
  useEffect(() => {
    if (!diffString) {
      hunkCountRef.current = 0
      return
    }
    const matches = diffString.match(/^@@ /gm)
    hunkCountRef.current = matches?.length ?? 0
    setCurrentHunkIndex(0)
  }, [diffString])

  const hunkCount = hunkCountRef.current

  const navigateHunk = (direction: 'prev' | 'next') => {
    if (hunkCount === 0) return
    const nextIndex =
      direction === 'prev'
        ? Math.max(0, currentHunkIndex - 1)
        : Math.min(hunkCount - 1, currentHunkIndex + 1)
    setCurrentHunkIndex(nextIndex)
  }

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Select a file to view changes
      </div>
    )
  }

  if (isLoading && !diffString) {
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

  if (!diffString || diffString.trim().length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No changes
      </div>
    )
  }

  const isBinary = diffString.includes('Binary files')

  if (isBinary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Binary file — cannot display diff
      </div>
    )
  }

  const toolbar = (onClose?: () => void) => (
    <div className="flex items-center gap-1 border-b border-zinc-700 px-2 py-1 flex-shrink-0">
      <span className="truncate text-xs text-zinc-500 mr-auto">{filePath}</span>
      {!onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setShowFullFile(!showFullFile)
            setCurrentHunkIndex(0)
          }}
          title={showFullFile ? 'Compact view' : 'Full file'}
        >
          {showFullFile ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => navigateHunk('prev')}
        disabled={hunkCount === 0 || currentHunkIndex === 0}
        title="Previous change"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => navigateHunk('next')}
        disabled={hunkCount === 0 || currentHunkIndex >= hunkCount - 1}
        title="Next change"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() =>
          openInIDE(filePath, preferredIde, terminalId).catch((err) =>
            toast.error(
              err instanceof Error ? err.message : 'Failed to open in IDE',
            ),
          )
        }
        title={`Open in ${preferredIde === 'cursor' ? 'Cursor' : 'VS Code'}`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Button>
      {onClose ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setMaximized(true)}
          title="Maximize"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )

  return (
    <>
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        {toolbar()}
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 overflow-auto">
            <DiffContent
              diffString={diffString}
              currentHunkIndex={currentHunkIndex}
              filePath={filePath}
              preferredIde={preferredIde}
              terminalId={terminalId}
            />
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
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
            {toolbar(() => setMaximized(false))}
            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 overflow-auto">
                <DiffContent
                  diffString={diffString}
                  currentHunkIndex={currentHunkIndex}
                  filePath={filePath}
                  preferredIde={preferredIde}
                  terminalId={terminalId}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
