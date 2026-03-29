import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Loader2,
  Maximize2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettings } from '@/hooks/useSettings'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'

type DiffEditorInstance = Parameters<DiffOnMount>[0]

/** Inner component that renders Monaco DiffEditor in inline (unified) mode */
function DiffContent({
  original,
  modified,
  language,
  filePath,
  preferredIde,
  terminalId,
  editorRef,
  showFullFile,
  fontSize,
}: {
  original: string
  modified: string
  language: string
  filePath: string
  preferredIde: 'cursor' | 'vscode'
  terminalId: number
  editorRef: React.MutableRefObject<DiffEditorInstance | null>
  showFullFile: boolean
  fontSize: number
}) {
  const openInIdeMutation = trpc.workspace.system.openInIde.useMutation()

  // Scroll to top when file changes
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.getModifiedEditor().setScrollTop(0)
  }, [filePath])

  const handleMount: DiffOnMount = (editor, monaco) => {
    editorRef.current = editor
    const modifiedEditor = editor.getModifiedEditor()

    // Highlight line numbers on hover to indicate clickability
    let decorationIds: string[] = []
    modifiedEditor.onMouseMove((e) => {
      const line = e.target.position?.lineNumber
      if (!line) {
        decorationIds = modifiedEditor.deltaDecorations(decorationIds, [])
        return
      }
      decorationIds = modifiedEditor.deltaDecorations(decorationIds, [
        {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            lineNumberClassName: 'diff-line-number-hover',
            lineNumberHoverMessage: { value: `Open in ${preferredIde}` },
          },
        },
      ])
    })
    modifiedEditor.onMouseLeave(() => {
      decorationIds = modifiedEditor.deltaDecorations(decorationIds, [])
    })

    // Click on line number → open in IDE
    modifiedEditor.onMouseDown((e) => {
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
        e.target.position
      ) {
        const lineNum = e.target.position.lineNumber
        openInIdeMutation
          .mutateAsync({
            path: `${filePath}:${lineNum}`,
            ide: preferredIde,
            terminal_id: terminalId,
          })
          .catch((err: unknown) => toastError(err, 'Failed to open in IDE'))
      }
    })
  }

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme="vs-dark"
      onMount={handleMount}
      loading={
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading editor...
        </div>
      }
      options={{
        renderSideBySide: false,
        readOnly: true,
        originalEditable: false,
        fontSize,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        automaticLayout: true,
        glyphMargin: false,
        hideUnchangedRegions: {
          enabled: !showFullFile,
          contextLineCount: 3,
          minimumLineCount: 3,
        },
        folding: false,
        lineNumbersMinChars: 4,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
    />
  )
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
  const openInIdeMutation = trpc.workspace.system.openInIde.useMutation()
  const { settings } = useSettings()
  const isMobile = useIsMobile()
  const fontSize = isMobile ? settings.mobile_font_size : settings.font_size
  const [maximized, setMaximized] = useState(false)
  const [showFullFile, setShowFullFile] = useState(false)
  const editorRef = useRef<DiffEditorInstance | null>(null)

  const { data, isLoading, error } = trpc.git.diff.fileContents.useQuery(
    {
      terminalId,
      path: filePath ?? '',
      base: base ?? undefined,
    },
    {
      enabled: filePath != null,
    },
  )

  const navigateHunk = (direction: 'prev' | 'next') => {
    const editor = editorRef.current
    if (!editor) return
    editor.goToDiff(direction === 'next' ? 'next' : 'previous')
  }

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Select a file to view changes
      </div>
    )
  }

  if (isLoading && !data) {
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

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No changes
      </div>
    )
  }

  if (data.binary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Binary file — cannot display diff
      </div>
    )
  }

  if (data.original === data.modified) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No changes
      </div>
    )
  }

  const diffEditor = (
    <DiffContent
      key={filePath}
      original={data.original}
      modified={data.modified}
      language={data.language}
      filePath={filePath}
      preferredIde={preferredIde}
      terminalId={terminalId}
      editorRef={editorRef}
      showFullFile={showFullFile}
      fontSize={fontSize}
    />
  )

  const toolbar = (onClose?: () => void) => (
    <div className="flex items-center gap-1 border-b border-zinc-700 px-2 py-1 flex-shrink-0">
      <span className="truncate text-xs text-zinc-500 mr-auto">{filePath}</span>
      <Button
        variant="ghost"
        size="icon"
        className={`h-7 w-7 ${showFullFile ? 'bg-zinc-700' : ''}`}
        onClick={() => setShowFullFile(!showFullFile)}
        title={showFullFile ? 'Compact view' : 'Full file'}
      >
        {showFullFile ? (
          <ListChevronsDownUp className="h-3.5 w-3.5" />
        ) : (
          <ListChevronsUpDown className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => navigateHunk('prev')}
        title="Previous change"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => navigateHunk('next')}
        title="Next change"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() =>
          openInIdeMutation
            .mutateAsync({
              path: filePath,
              ide: preferredIde,
              terminal_id: terminalId,
            })
            .catch((err: unknown) => toastError(err, 'Failed to open in IDE'))
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
          {!maximized && diffEditor}
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
              {maximized && diffEditor}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
