import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  Loader2,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Group, Panel, type PanelSize, Separator } from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSettings } from '@/hooks/useSettings'
import {
  commitChanges,
  discardChanges,
  getChangedFiles,
  getHeadMessage,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ChangedFile, FileStatus } from '../../shared/types'
import { ConfirmModal } from './ConfirmModal'
import { FileDiffViewer } from './FileDiffViewer'
import { TruncatedPath } from './TruncatedPath'

const STATUS_CONFIG: Record<FileStatus, { label: string; className: string }> =
  {
    added: { label: 'A', className: 'bg-green-900/50 text-green-400' },
    modified: { label: 'M', className: 'bg-blue-900/50 text-blue-400' },
    deleted: { label: 'D', className: 'bg-red-900/50 text-red-400' },
    renamed: { label: 'R', className: 'bg-yellow-900/50 text-yellow-400' },
    untracked: { label: 'U', className: 'bg-zinc-700/50 text-zinc-400' },
  }

function FileStatusBadge({ status }: { status: FileStatus }) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded text-xs font-mono font-semibold',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

interface CommitDialogProps {
  open: boolean
  terminalId: number
  onClose: () => void
  onSuccess?: () => void
}

export function CommitDialog({
  open,
  terminalId,
  onClose,
  onSuccess,
}: CommitDialogProps) {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [noVerify, setNoVerify] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchingMessage, setFetchingMessage] = useState(false)
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [groupByFolder, setGroupByFolder] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [discarding, setDiscarding] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [fileListWidth, setFileListWidth] = useState<number | undefined>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const handleCommitRef = useRef<() => void>(() => {})
  const canCommitRef = useRef(false)
  const { settings } = useSettings()

  // Listen for custom events from global keyboard shortcuts
  useEffect(() => {
    if (!open) return
    const onToggleAmend = () =>
      setAmend((v) => {
        if (v) setMessage('')
        return !v
      })
    const onToggleNoVerify = () => setNoVerify((v) => !v)
    window.addEventListener('commit-toggle-amend', onToggleAmend)
    window.addEventListener('commit-toggle-no-verify', onToggleNoVerify)
    return () => {
      window.removeEventListener('commit-toggle-amend', onToggleAmend)
      window.removeEventListener('commit-toggle-no-verify', onToggleNoVerify)
    }
  }, [open])

  function refreshFiles() {
    setLoadingFiles(true)
    getChangedFiles(terminalId)
      .then((data) => {
        setChangedFiles(data.files)
        setSelectedFiles(new Set(data.files.map((f) => f.path)))
        if (data.files.length > 0) {
          setSelectedFile(data.files[0].path)
        }
      })
      .catch(() => {
        setChangedFiles([])
      })
      .finally(() => {
        setLoadingFiles(false)
      })
  }

  // Fetch changed files on dialog open
  useEffect(() => {
    if (!open) {
      setMessage('')
      setAmend(false)
      setNoVerify(false)
      setChangedFiles([])
      setSelectedFiles(new Set())
      setLoadingFiles(false)
      setSelectedFile(null)
      setGroupByFolder(false)
      setExpandedFolders(new Set())
      return
    }

    refreshFiles()
  }, [open, terminalId])

  // When amend is toggled on, fetch HEAD message
  useEffect(() => {
    if (!amend) return
    let cancelled = false
    setFetchingMessage(true)
    getHeadMessage(terminalId)
      .then((data) => {
        if (!cancelled) {
          setMessage(data.message)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to get HEAD message',
          )
          setAmend(false)
        }
      })
      .finally(() => {
        if (!cancelled) setFetchingMessage(false)
      })
    return () => {
      cancelled = true
    }
  }, [amend, terminalId])

  // Cmd/Ctrl+Enter to commit from anywhere in the dialog
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey) &&
        canCommitRef.current
      ) {
        e.preventDefault()
        e.stopPropagation()
        handleCommitRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const handleAmendChange = (checked: boolean) => {
    setAmend(checked)
    if (!checked) {
      setMessage('')
    }
  }

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

  // Build grouped file structure
  const folderGroups: Map<string, ChangedFile[]> = new Map()
  for (const file of changedFiles) {
    const lastSlash = file.path.lastIndexOf('/')
    const folder = lastSlash === -1 ? '.' : file.path.substring(0, lastSlash)
    const group = folderGroups.get(folder)
    if (group) {
      group.push(file)
    } else {
      folderGroups.set(folder, [file])
    }
  }
  const sortedFolders = [...folderGroups.keys()].sort((a, b) => {
    if (a === '.') return 1
    if (b === '.') return -1
    return a.localeCompare(b)
  })

  const toggleFolder = (folder: string) => {
    const next = new Set(expandedFolders)
    if (next.has(folder)) {
      next.delete(folder)
    } else {
      next.add(folder)
    }
    setExpandedFolders(next)
  }

  const toggleFolderFiles = (folder: string) => {
    const files = folderGroups.get(folder) ?? []
    const next = new Set(selectedFiles)
    const allInFolder = files.every((f) => next.has(f.path))
    for (const f of files) {
      if (allInFolder) {
        next.delete(f.path)
      } else {
        next.add(f.path)
      }
    }
    setSelectedFiles(next)
  }

  const handleCommit = async () => {
    setLoading(true)
    try {
      const filesToSend = allSelected ? undefined : Array.from(selectedFiles)
      await commitChanges(terminalId, message, amend, noVerify, filesToSend)
      toast.success(amend ? 'Amended commit' : 'Changes committed')
      onClose()
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to commit')
    } finally {
      setLoading(false)
    }
  }

  const handleDiscard = async () => {
    setDiscarding(true)
    try {
      await discardChanges(terminalId, Array.from(selectedFiles))
      toast.success(
        `Discarded ${selectedFiles.size} file${selectedFiles.size > 1 ? 's' : ''}`,
      )
      setConfirmDiscard(false)
      refreshFiles()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to discard changes',
      )
    } finally {
      setDiscarding(false)
    }
  }

  const canCommit = (amend || !!message.trim()) && selectedFiles.size > 0
  handleCommitRef.current = handleCommit
  canCommitRef.current = canCommit

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="w-[95vw] p-4 sm:max-w-[1500px] h-[95vh] max-h-[1500px] flex flex-col overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          textareaRef.current?.focus()
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="hidden">
          <DialogTitle>Commit Changes</DialogTitle>
        </DialogHeader>

        {/* Two-column layout */}
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-700"
        >
          {/* Left column: file list */}
          <Panel
            id="commit-files"
            defaultSize="280px"
            minSize="180px"
            maxSize="50%"
            onResize={(size: PanelSize) => setFileListWidth(size.inPixels)}
          >
            <div
              className="flex flex-col h-full overflow-hidden"
              style={{ maxWidth: fileListWidth }}
            >
              {/* Toolbar */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-700">
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
                {groupByFolder && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          const allExpanded = sortedFolders.every((f) =>
                            expandedFolders.has(f),
                          )
                          setExpandedFolders(
                            allExpanded ? new Set() : new Set(sortedFolders),
                          )
                        }}
                      >
                        {sortedFolders.every((f) => expandedFolders.has(f)) ? (
                          <ChevronsDownUp className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {sortedFolders.every((f) => expandedFolders.has(f))
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={refreshFiles}
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
                      onClick={() => setConfirmDiscard(true)}
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
                  sortedFolders.map((folder) => {
                    const files = folderGroups.get(folder) ?? []
                    const isExpanded = expandedFolders.has(folder)
                    const allInFolder = files.every((f) =>
                      selectedFiles.has(f.path),
                    )
                    const someInFolder =
                      !allInFolder &&
                      files.some((f) => selectedFiles.has(f.path))
                    return (
                      <div key={folder}>
                        <div
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-zinc-800/50 cursor-pointer"
                          onClick={() => toggleFolder(folder)}
                        >
                          <Checkbox
                            checked={
                              allInFolder
                                ? true
                                : someInFolder
                                  ? 'indeterminate'
                                  : false
                            }
                            onCheckedChange={() => toggleFolderFiles(folder)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={loading}
                            className="h-4 w-4"
                          />
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
                                {folder === '.' ? '/' : folder}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {folder === '.' ? '/' : folder}
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-zinc-500 text-xs">
                            {files.length}
                          </span>
                        </div>
                        {isExpanded &&
                          files.map((file) => {
                            const fileName = file.path.substring(
                              file.path.lastIndexOf('/') + 1,
                            )
                            return (
                              <div
                                key={file.path}
                                className={cn(
                                  'flex w-full items-center gap-2 pl-6 pr-3 py-1.5 text-sm hover:bg-zinc-800/50 cursor-pointer',
                                  selectedFile === file.path &&
                                    'bg-zinc-700/50',
                                )}
                                onClick={() => setSelectedFile(file.path)}
                              >
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
                                <FileStatusBadge status={file.status} />
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex-1 min-w-0 text-left text-zinc-300 font-mono text-[0.7rem]">
                                      <TruncatedPath path={fileName} />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    {file.path}
                                  </TooltipContent>
                                </Tooltip>
                                {(file.added > 0 || file.removed > 0) && (
                                  <span className="flex-shrink-0 font-mono text-[0.7rem]">
                                    {file.added > 0 && (
                                      <span className="text-green-400">
                                        +{file.added}
                                      </span>
                                    )}
                                    {file.added > 0 && file.removed > 0 && ' '}
                                    {file.removed > 0 && (
                                      <span className="text-red-400">
                                        -{file.removed}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    )
                  })
                ) : (
                  changedFiles.map((file) => (
                    <div
                      key={file.path}
                      className={cn(
                        'flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-zinc-800/50 cursor-pointer',
                        selectedFile === file.path && 'bg-zinc-700/50',
                      )}
                      onClick={() => setSelectedFile(file.path)}
                    >
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
                      <FileStatusBadge status={file.status} />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex-1 min-w-0 text-left text-zinc-300 font-mono text-[0.7rem]">
                            <TruncatedPath path={file.path} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {file.path}
                        </TooltipContent>
                      </Tooltip>
                      {(file.added > 0 || file.removed > 0) && (
                        <span className="flex-shrink-0 font-mono text-xs">
                          {file.added > 0 && (
                            <span className="text-green-400">
                              +{file.added}
                            </span>
                          )}
                          {file.added > 0 && file.removed > 0 && ' '}
                          {file.removed > 0 && (
                            <span className="text-red-400">
                              -{file.removed}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </Panel>
          <Separator className="panel-resize-handle" />
          {/* Right column: commit message + diff viewer */}
          <Panel id="commit-diff">
            <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-3 overflow-hidden h-full p-3">
              {/* Commit message + options */}
              <div className="flex gap-3 flex-shrink-0 p-0.5">
                <textarea
                  ref={textareaRef}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none"
                  rows={4}
                  placeholder="Commit message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={amend || loading}
                />
                <div className="flex flex-col gap-2 flex-shrink-0 justify-start">
                  <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                    <Checkbox
                      checked={amend}
                      onCheckedChange={(v) => handleAmendChange(v === true)}
                      disabled={loading}
                      className="h-4 w-4"
                    />
                    Amend
                    {fetchingMessage && (
                      <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                    <Checkbox
                      checked={noVerify}
                      onCheckedChange={(v) => setNoVerify(v === true)}
                      disabled={loading}
                      className="h-4 w-4"
                    />
                    No verify
                  </label>
                </div>
              </div>

              {/* Diff viewer */}
              <div className="flex-1 min-h-0 rounded-md border border-zinc-700 overflow-hidden flex flex-col">
                <FileDiffViewer
                  terminalId={terminalId}
                  filePath={selectedFile}
                  preferredIde={settings?.preferred_ide ?? 'cursor'}
                />
              </div>
            </div>
          </Panel>
        </Group>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCommit} disabled={!canCommit || loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {amend ? 'Amend' : 'Commit'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmModal
        open={confirmDiscard}
        title="Discard changes?"
        message={`This will permanently discard changes in ${selectedFiles.size} file${selectedFiles.size > 1 ? 's' : ''}. This action cannot be undone.`}
        confirmLabel="Discard"
        variant="danger"
        onConfirm={handleDiscard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </Dialog>
  )
}
