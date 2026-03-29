import type { FileStatus } from '@domains/git/schema'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FileStatusBadge } from '@/components/FileStatusBadge'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettings } from '@/hooks/useSettings'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 5
/** How far off-screen (px) before an editor is unmounted */
const OFFSCREEN_MARGIN = 1500

type FileItem = {
  path: string
  status: FileStatus
  original: string
  modified: string
  language: string
  binary: boolean
}

interface UnifiedDiffViewerProps {
  terminalId: number
  base?: string
  scrollToFile?: string | null
  onScrollComplete?: () => void
}

function DiffItem({
  item,
  fontSize,
  scrollRoot,
}: {
  item: FileItem
  fontSize: number
  scrollRoot: HTMLElement | null
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [editorHeight, setEditorHeight] = useState(100)
  const [visible, setVisible] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const disposableRef = useRef<{ dispose(): void } | null>(null)

  // Clean up listener when editor unmounts
  useEffect(() => {
    return () => disposableRef.current?.dispose()
  }, [])

  const handleMount: DiffOnMount = (editor, monaco) => {
    const modifiedEditor = editor.getModifiedEditor()

    const noValidation = {
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    }
    const jsxCompiler = {
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
    }
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(noValidation)
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(jsxCompiler)
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(noValidation)
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(jsxCompiler)

    const updateHeight = () => {
      try {
        setEditorHeight(modifiedEditor.getContentHeight())
      } catch {
        // Editor already disposed
      }
    }
    disposableRef.current?.dispose()
    disposableRef.current = modifiedEditor.onDidContentSizeChange(updateHeight)
    updateHeight()
  }

  // Track visibility — mount when near viewport, unmount when far away
  useEffect(() => {
    const el = containerRef.current
    if (!el || !scrollRoot) return

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries[0].isIntersecting)
      },
      { root: scrollRoot, rootMargin: `${OFFSCREEN_MARGIN}px` },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRoot])

  const showEditor = visible && !collapsed
  const hasDiff = item.original !== item.modified && !item.binary

  const header = (
    <button
      type="button"
      className="flex items-center gap-2 w-full pl-1 py-1.5 text-xs font-mono text-zinc-300 bg-zinc-900 border-b border-zinc-700/50 cursor-pointer hover:bg-zinc-800 sticky top-0 z-10"
      onClick={() => setCollapsed(!collapsed)}
    >
      <ChevronDown
        className={cn(
          'w-3 h-3 min-w-3 transition-transform',
          collapsed && '-rotate-90',
        )}
      />
      <FileStatusBadge status={item.status} />
      <span className="overflow-x-auto whitespace-nowrap">{item.path}</span>
    </button>
  )

  if (item.binary) {
    return (
      <div ref={containerRef}>
        {header}
        {!collapsed && (
          <div className="flex items-center justify-center h-16 text-xs text-zinc-500">
            Binary file — cannot display diff
          </div>
        )}
      </div>
    )
  }

  if (!hasDiff) {
    return (
      <div ref={containerRef}>
        {header}
        {!collapsed && (
          <div className="flex items-center justify-center h-16 text-xs text-zinc-500">
            No changes
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      {header}
      {!collapsed && (
        <div style={{ height: editorHeight }}>
          {showEditor ? (
            <DiffEditor
              original={item.original}
              modified={item.modified}
              language={item.language}
              theme="vs-dark"
              onMount={handleMount}
              keepCurrentOriginalModel
              keepCurrentModifiedModel
              loading={
                <div
                  className="flex items-center justify-center text-sm text-zinc-500"
                  style={{ height: 100 }}
                >
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                </div>
              }
              options={{
                renderSideBySide: false,
                readOnly: true,
                domReadOnly: true,
                originalEditable: false,
                fontSize,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                renderOverviewRuler: false,
                automaticLayout: true,
                glyphMargin: false,
                hideUnchangedRegions: {
                  enabled: true,
                  contextLineCount: 3,
                  minimumLineCount: 3,
                },
                folding: false,
                lineNumbersMinChars: 4,
                scrollbar: {
                  vertical: 'hidden',
                  horizontalScrollbarSize: 8,
                  alwaysConsumeMouseWheel: false,
                },
              }}
            />
          ) : (
            <div className="h-full bg-zinc-900/30" />
          )}
        </div>
      )}
    </div>
  )
}

export function UnifiedDiffViewer({
  terminalId,
  base,
  scrollToFile,
  onScrollComplete,
}: UnifiedDiffViewerProps) {
  const { settings } = useSettings()
  const isMobile = useIsMobile()
  const fontSize = isMobile ? settings.mobile_font_size : settings.font_size
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.git.diff.batchFileContents.useInfiniteQuery(
      { terminalId, base: base ?? undefined, pageSize: PAGE_SIZE },
      {
        initialCursor: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    )

  const allItems = data?.pages.flatMap((p) => p.items) ?? []
  const totalFiles = data?.pages[0]?.totalFiles ?? 0

  // IntersectionObserver on sentinel to trigger next page
  // Delay observer setup so first page editors can mount and push sentinel out of view
  useEffect(() => {
    const sentinel = sentinelRef.current
    const container = scrollContainerRef.current
    if (!sentinel || !container || allItems.length === 0) return

    let observer: IntersectionObserver | null = null
    const timer = setTimeout(() => {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
          }
        },
        { root: container, rootMargin: '200px' },
      )
      observer.observe(sentinel)
    }, 500)
    return () => {
      clearTimeout(timer)
      observer?.disconnect()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allItems.length])

  // Scroll to file
  useEffect(() => {
    if (!scrollToFile || !scrollContainerRef.current) return
    const el = scrollContainerRef.current.querySelector(
      `[data-file-path="${CSS.escape(scrollToFile)}"]`,
    )
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    onScrollComplete?.()
  }, [scrollToFile, onScrollComplete])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading diff...
      </div>
    )
  }

  if (allItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        No changes
      </div>
    )
  }

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto">
      {allItems.map((item) => (
        <div key={item.path} data-file-path={item.path}>
          <DiffItem
            item={item}
            fontSize={fontSize}
            scrollRoot={scrollContainerRef.current}
          />
        </div>
      ))}
      <div ref={sentinelRef} className="h-1" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading more files... ({allItems.length}/{totalFiles})
        </div>
      )}
    </div>
  )
}
