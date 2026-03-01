import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  Loader2,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Group, Panel, type PanelSize, Separator } from 'react-resizable-panels'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSettings } from '@/hooks/useSettings'
import { getChangedFiles } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ChangedFile } from '../../shared/types'
import { FileDiffViewer } from './FileDiffViewer'
import { FileStatusBadge } from './FileStatusBadge'
import { TruncatedPath } from './TruncatedPath'

// --- Folder tree helpers ---

interface FolderNode {
  name: string // display name (compressed segments like "packages/api/src")
  fullPath: string // full path for expand/collapse tracking
  files: ChangedFile[]
  children: FolderNode[]
}

function buildFolderTree(files: ChangedFile[]): FolderNode {
  const root: FolderNode = {
    name: '',
    fullPath: '',
    files: [],
    children: [],
  }

  for (const file of files) {
    const lastSlash = file.path.lastIndexOf('/')
    if (lastSlash === -1) {
      root.files.push(file)
      continue
    }
    const segments = file.path.substring(0, lastSlash).split('/')
    let current = root
    let currentPath = ''
    for (const seg of segments) {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg
      let child = current.children.find((c) => c.fullPath === currentPath)
      if (!child) {
        child = { name: seg, fullPath: currentPath, files: [], children: [] }
        current.children.push(child)
      }
      current = child
    }
    current.files.push(file)
  }

  // Compress single-child nodes with no files
  function compress(node: FolderNode): FolderNode {
    node.children = node.children.map(compress)
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    while (
      node.children.length === 1 &&
      node.files.length === 0 &&
      node.name !== ''
    ) {
      const child = node.children[0]
      node.name = `${node.name}/${child.name}`
      node.fullPath = child.fullPath
      node.files = child.files
      node.children = child.children
    }
    return node
  }

  root.children = root.children.map(compress)
  root.children.sort((a, b) => a.name.localeCompare(b.name))
  return root
}

function getNodeFileCount(node: FolderNode): number {
  return (
    node.files.length +
    node.children.reduce((sum, c) => sum + getNodeFileCount(c), 0)
  )
}

function getNodeAllFiles(node: FolderNode): ChangedFile[] {
  return [...node.files, ...node.children.flatMap((c) => getNodeAllFiles(c))]
}

function getNodeAllPaths(node: FolderNode): string[] {
  return [node.fullPath, ...node.children.flatMap((c) => getNodeAllPaths(c))]
}

// --- FileListPanel (owns selectedFiles state to isolate checkbox re-renders) ---

export interface FileListHandle {
  getSelectedFiles(): Set<string>
  resetSelection(files: ChangedFile[]): void
}

interface FileListPanelProps {
  ref: React.Ref<FileListHandle>
  changedFiles: ChangedFile[]
  loadingFiles: boolean
  loading: boolean
  discarding: boolean
  selectedFile: string | null
  fileListWidth: number | undefined
  readOnly?: boolean
  onSelectFile: (path: string) => void
  onRefresh: () => void
  onRequestDiscard: (files: Set<string>) => void
  onHasSelectionChange: (hasSelection: boolean) => void
}

function FileListPanel({
  ref,
  changedFiles,
  loadingFiles,
  loading,
  discarding,
  selectedFile,
  fileListWidth,
  readOnly,
  onSelectFile,
  onRefresh,
  onRequestDiscard,
  onHasSelectionChange,
}: FileListPanelProps) {
  const [selectedFiles, setSelectedFilesRaw] = useState<Set<string>>(new Set())
  const [groupByFolder, setGroupByFolder] = useState(true)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const setSelectedFiles = (next: Set<string>) => {
    setSelectedFilesRaw(next)
    onHasSelectionChange(next.size > 0)
  }

  useImperativeHandle(ref, () => ({
    getSelectedFiles: () => selectedFiles,
    resetSelection: (files: ChangedFile[]) => {
      const next = new Set(files.map((f) => f.path))
      setSelectedFilesRaw(next)
      onHasSelectionChange(next.size > 0)
    },
  }))

  const toggleFile = (path: string) => {
    const next = new Set(selectedFiles)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    setSelectedFiles(next)
  }

  const allSelected =
    changedFiles.length > 0 && selectedFiles.size === changedFiles.length

  const toggleAll = () => {
    if (allSelected) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(changedFiles.map((f) => f.path)))
    }
  }

  // Build recursive folder tree
  const tree = buildFolderTree(changedFiles)
  const allFolderPaths = tree.children.flatMap((c) => getNodeAllPaths(c))

  // Auto-expand all folders when files change
  useEffect(() => {
    if (changedFiles.length > 0) {
      setExpandedFolders(new Set(allFolderPaths))
    }
  }, [changedFiles])

  const toggleFolder = (folder: string) => {
    const next = new Set(expandedFolders)
    if (next.has(folder)) {
      next.delete(folder)
    } else {
      next.add(folder)
    }
    setExpandedFolders(next)
  }

  const toggleNodeFiles = (node: FolderNode) => {
    const files = getNodeAllFiles(node)
    const next = new Set(selectedFiles)
    const allInNode = files.every((f) => next.has(f.path))
    for (const f of files) {
      if (allInNode) {
        next.delete(f.path)
      } else {
        next.add(f.path)
      }
    }
    setSelectedFiles(next)
  }

  function renderFileRow(file: ChangedFile, depth: number) {
    const fileName = file.path.substring(file.path.lastIndexOf('/') + 1)
    return (
      <div
        key={file.path}
        className={cn(
          'flex w-full items-center gap-2 pr-3 py-1.5 text-sm hover:bg-zinc-800/50 cursor-pointer',
          selectedFile === file.path && 'bg-zinc-700/50',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelectFile(file.path)}
      >
        {!readOnly && (
          <Checkbox
            checked={selectedFiles.has(file.path)}
            onCheckedChange={(e) => {
              e
              toggleFile(file.path)
            }}
            onClick={(e) => e.stopPropagation()}
            disabled={loading}
            className="h-4 w-4"
          />
        )}
        <FileStatusBadge status={file.status} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 min-w-0 text-left text-zinc-300 font-mono text-[0.7rem]">
              <TruncatedPath path={fileName} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{file.path}</TooltipContent>
        </Tooltip>
        {(file.added > 0 || file.removed > 0) && (
          <span className="flex-shrink-0 font-mono text-[0.7rem]">
            {file.added > 0 && (
              <span className="text-green-400">+{file.added}</span>
            )}
            {file.added > 0 && file.removed > 0 && ' '}
            {file.removed > 0 && (
              <span className="text-red-400">-{file.removed}</span>
            )}
          </span>
        )}
      </div>
    )
  }

  function renderFolderNode(node: FolderNode, depth: number) {
    const isExpanded = expandedFolders.has(node.fullPath)
    const allFiles = getNodeAllFiles(node)
    const allInNode =
      allFiles.length > 0 && allFiles.every((f) => selectedFiles.has(f.path))
    const someInNode =
      !allInNode && allFiles.some((f) => selectedFiles.has(f.path))

    return (
      <div key={node.fullPath}>
        <div
          className="flex w-full items-center gap-2 pr-2 py-1.5 text-sm hover:bg-zinc-800/50 cursor-pointer"
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => toggleFolder(node.fullPath)}
        >
          {!readOnly && (
            <Checkbox
              checked={allInNode ? true : someInNode ? 'indeterminate' : false}
              onCheckedChange={() => toggleNodeFiles(node)}
              onClick={(e) => e.stopPropagation()}
              disabled={loading}
              className="h-4 w-4"
            />
          )}
          <ChevronDown
            className={cn(
              'size-3 text-zinc-400 transition-transform duration-150',
              !isExpanded && '-rotate-90',
            )}
          />
          <Folder className="size-3 text-zinc-400" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-1 min-w-0 text-left text-zinc-300 font-mono text-[0.7rem] truncate">
                {node.name}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{node.fullPath}</TooltipContent>
          </Tooltip>
          <span className="text-zinc-500 text-xs">
            {getNodeFileCount(node)}
          </span>
        </div>
        {isExpanded && (
          <>
            {node.files.map((file) => renderFileRow(file, depth + 1))}
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
          </>
        )}
      </div>
    )
  }

  function renderFolderTree(root: FolderNode, depth: number) {
    return (
      <>
        {root.files.map((file) => renderFileRow(file, depth))}
        {root.children.map((child) => renderFolderNode(child, depth))}
      </>
    )
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ maxWidth: fileListWidth }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-zinc-700">
        {!readOnly && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : selectedFiles.size > 0
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={() => toggleAll()}
                    disabled={
                      loading || loadingFiles || changedFiles.length === 0
                    }
                    className="h-4 w-4"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {allSelected ? 'Deselect all' : 'Select all'}
              </TooltipContent>
            </Tooltip>
            <span className="text-zinc-500 text-xs mr-auto">
              {selectedFiles.size}/{changedFiles.length}
            </span>
          </>
        )}
        {readOnly && (
          <span className="text-zinc-500 text-xs mr-auto">
            {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''}
          </span>
        )}
        {groupByFolder && allFolderPaths.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  const allExpanded = allFolderPaths.every((f) =>
                    expandedFolders.has(f),
                  )
                  setExpandedFolders(
                    allExpanded ? new Set() : new Set(allFolderPaths),
                  )
                }}
              >
                {allFolderPaths.every((f) => expandedFolders.has(f)) ? (
                  <ChevronsDownUp className="size-3" />
                ) : (
                  <ChevronsUpDown className="size-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {allFolderPaths.every((f) => expandedFolders.has(f))
                ? 'Collapse all'
                : 'Expand all'}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setGroupByFolder((v) => !v)}
              className={cn(groupByFolder && 'bg-zinc-700')}
            >
              <Folder className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Group by folder</TooltipContent>
        </Tooltip>
        {!readOnly && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onRefresh}
                  disabled={loading || loadingFiles}
                >
                  <RefreshCw
                    className={cn('size-3', loadingFiles && 'animate-spin')}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh files</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRequestDiscard(new Set(selectedFiles))}
                  disabled={
                    loading ||
                    discarding ||
                    loadingFiles ||
                    selectedFiles.size === 0
                  }
                >
                  {discarding ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Undo2 className="size-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard selected changes</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto border-t border-zinc-700">
        {loadingFiles ? (
          <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading files...
          </div>
        ) : changedFiles.length === 0 ? (
          <div className="py-4 text-center text-sm text-zinc-500">
            No changed files
          </div>
        ) : groupByFolder ? (
          renderFolderTree(tree, 0)
        ) : (
          changedFiles.map((file) => (
            <div
              key={file.path}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-zinc-800/50 cursor-pointer',
                selectedFile === file.path && 'bg-zinc-700/50',
              )}
              onClick={() => onSelectFile(file.path)}
            >
              {!readOnly && (
                <Checkbox
                  checked={selectedFiles.has(file.path)}
                  onCheckedChange={(e) => {
                    e // keep TS happy
                    toggleFile(file.path)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  disabled={loading}
                  className="h-4 w-4"
                />
              )}
              <FileStatusBadge status={file.status} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1 min-w-0 text-left text-zinc-300 font-mono text-[0.7rem]">
                    <TruncatedPath path={file.path} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{file.path}</TooltipContent>
              </Tooltip>
              {(file.added > 0 || file.removed > 0) && (
                <span className="flex-shrink-0 font-mono text-xs">
                  {file.added > 0 && (
                    <span className="text-green-400">+{file.added}</span>
                  )}
                  {file.added > 0 && file.removed > 0 && ' '}
                  {file.removed > 0 && (
                    <span className="text-red-400">-{file.removed}</span>
                  )}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// --- DiffViewerPanel ---

interface DiffViewerPanelProps {
  terminalId: number
  base?: string // e.g. "origin/main...origin/feature" or "abc123^..abc123"
  readOnly?: boolean // true = no checkboxes/discard (always true for CreatePR)
  // Commit mode props (optional, only used by CommitDialog)
  commitControls?: React.ReactNode // textarea + amend/noVerify rendered above diff
  onHasSelectionChange?: (has: boolean) => void
  fileListRef?: React.Ref<FileListHandle>
  // Discard support (commit mode only)
  loading?: boolean
  discarding?: boolean
  onRefresh?: () => void
  onRequestDiscard?: (files: Set<string>) => void
  // External file data (when caller manages file fetching)
  externalFiles?: ChangedFile[]
  externalLoadingFiles?: boolean
  integrated?: boolean
}

export function DiffViewerPanel({
  terminalId,
  base,
  readOnly,
  commitControls,
  onHasSelectionChange,
  fileListRef,
  loading = false,
  discarding = false,
  integrated = false,
  onRefresh,
  onRequestDiscard,
  externalFiles,
  externalLoadingFiles,
}: DiffViewerPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileListWidth, setFileListWidth] = useState<number | undefined>()
  const internalFileListRef = useRef<FileListHandle>(null)
  const { settings } = useSettings()

  // Fetch changed files via SWR (only when managing internally)
  const swrKey =
    externalFiles === undefined && base
      ? ['changed-files', terminalId, base]
      : null
  const {
    data: internalData,
    isLoading: internalLoadingFiles,
    mutate: mutateFiles,
  } = useSWR(
    swrKey,
    async ([, tid, b]) => {
      const data = await getChangedFiles(tid as number, b as string)
      return data.files
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  const changedFiles = externalFiles ?? internalData ?? []
  const loadingFiles = externalLoadingFiles ?? internalLoadingFiles
  const effectiveFileListRef = fileListRef ?? internalFileListRef

  // Auto-select first file when files or base changes
  const prevBaseRef = useRef(base)
  useEffect(() => {
    const files = externalFiles ?? internalData
    const baseChanged = prevBaseRef.current !== base
    prevBaseRef.current = base

    if (!files || files.length === 0) {
      if (baseChanged) setSelectedFile(null)
      return
    }

    const fileExists = files.some((f) => f.path === selectedFile)
    if (baseChanged || !selectedFile || !fileExists) {
      setSelectedFile(files[0].path)
    }
  }, [externalFiles, internalData, base])

  return (
    <Group
      orientation="horizontal"
      className={cn(
        'min-h-0 flex-1 overflow-hidden',
        !integrated && 'rounded-md border border-zinc-700',
      )}
    >
      {/* Left column: file list */}
      <Panel
        id="diff-files"
        defaultSize="280px"
        minSize="180px"
        maxSize="50%"
        onResize={(size: PanelSize) => setFileListWidth(size.inPixels)}
      >
        <FileListPanel
          ref={effectiveFileListRef}
          changedFiles={changedFiles}
          loadingFiles={loadingFiles}
          loading={loading}
          discarding={discarding}
          selectedFile={selectedFile}
          fileListWidth={fileListWidth}
          readOnly={readOnly}
          onSelectFile={setSelectedFile}
          onRefresh={onRefresh ?? (() => mutateFiles())}
          onRequestDiscard={onRequestDiscard ?? (() => {})}
          onHasSelectionChange={onHasSelectionChange ?? (() => {})}
        />
      </Panel>
      <Separator className="panel-resize-handle" />
      {/* Right column: commit controls + diff viewer */}
      <Panel id="diff-viewer">
        <div
          className={cn(
            'flex-1 flex flex-col min-h-0 min-w-0 gap-3 overflow-hidden h-full',
            !integrated && 'p-3',
          )}
        >
          {commitControls}
          {/* Diff viewer */}
          <div
            className={cn(
              'flex-1 min-h-0 overflow-hidden flex flex-col',
              !integrated && 'rounded-md border border-zinc-700',
            )}
          >
            <FileDiffViewer
              terminalId={terminalId}
              filePath={selectedFile}
              preferredIde={settings?.preferred_ide ?? 'cursor'}
              base={base}
            />
          </div>
        </div>
      </Panel>
    </Group>
  )
}
