import { ChevronRight, File, Folder, Loader2, ShieldAlert } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { type DirEntry, listDirectories, openFullDiskAccess } from '../lib/api'

interface Column {
  path: string
  selectedDir: string | null
  initialEntries?: DirEntry[]
  initialHasMore?: boolean
}

interface DirectoryBrowserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onSelect: (path: string) => void
  sshHost?: string
  mode?: 'directory' | 'file'
  onSelectPaths?: (paths: string[]) => void
  title?: string
}

export function DirectoryBrowser({
  open,
  onOpenChange,
  value,
  onSelect,
  sshHost,
  mode = 'directory',
  onSelectPaths,
  title,
}: DirectoryBrowserProps) {
  const [columns, setColumns] = useState<Column[]>([])
  const [inputPath, setInputPath] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [hiddenVersion, setHiddenVersion] = useState(0)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const defaultRoot = '~'

  // Initialize columns when dialog opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when dialog opens
  useEffect(() => {
    if (!open) return
    if (value) {
      navigateToPath(value)
    } else {
      setColumns([{ path: defaultRoot, selectedDir: null }])
      setInputPath(defaultRoot)
    }
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally triggers on showHidden change
  useEffect(() => {
    setHiddenVersion((v) => v + 1)
  }, [showHidden])

  const navigateToPath = useCallback(
    async (rawPath: string) => {
      // Split path into segments: /Users/apo -> ["/", "/Users", "/Users/apo"]
      const segments = buildPathSegments(rawPath)
      if (segments.length === 0) {
        setColumns([{ path: defaultRoot, selectedDir: null }])
        setInputPath(defaultRoot)
        return
      }

      try {
        const res = await listDirectories(segments, 0, showHidden, sshHost)

        const newColumns: Column[] = []
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]
          const result = res.results[seg]
          if (result?.error) {
            // Stop building columns at the point of error
            newColumns.push({ path: seg, selectedDir: null })
            break
          }
          const nextSeg = segments[i + 1]
          const selectedDir = nextSeg
            ? nextSeg.split('/').filter(Boolean).pop() || null
            : null
          newColumns.push({
            path: seg,
            selectedDir,
            initialEntries: result?.entries,
            initialHasMore: result?.hasMore ?? false,
          })
        }

        setColumns(newColumns)
        setInputPath(segments[segments.length - 1])
      } catch {
        // Fallback: just show root
        setColumns([{ path: defaultRoot, selectedDir: null }])
        setInputPath(defaultRoot)
      }
    },
    [showHidden, sshHost],
  )

  const handleColumnSelect = useCallback(
    (colIndex: number, dirName: string) => {
      setColumns((prev) => {
        const updated = prev.slice(0, colIndex + 1)
        updated[colIndex] = { ...updated[colIndex], selectedDir: dirName }
        const parentPath = updated[colIndex].path
        const newPath =
          parentPath === '/' ? `/${dirName}` : `${parentPath}/${dirName}`
        updated.push({ path: newPath, selectedDir: null })
        setInputPath(newPath)
        return updated
      })
      if (mode === 'file') setSelectedPaths(new Set())
    },
    [mode],
  )

  const handleSelectEntry = useCallback(
    (fullPath: string, metaKey: boolean) => {
      setSelectedPaths((prev) => {
        if (metaKey) {
          const next = new Set(prev)
          if (next.has(fullPath)) next.delete(fullPath)
          else next.add(fullPath)
          return next
        }
        return new Set([fullPath])
      })
    },
    [],
  )

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = inputPath.trim()
      if (trimmed) {
        navigateToPath(trimmed)
      }
    }
  }

  const handleSave = () => {
    if (mode === 'file' && onSelectPaths) {
      onSelectPaths(Array.from(selectedPaths))
      onOpenChange(false)
      return
    }
    const selected = inputPath.trim() || defaultRoot
    onSelect(selected)
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-sidebar sm:max-w-[90vw] p-0 gap-0 flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>
            {title ?? (mode === 'file' ? 'Select Files' : 'Select Folder')}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-3 flex items-center gap-3">
          <Input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={defaultRoot}
            className="flex-1 font-mono text-sm"
          />
          <div className="flex items-center gap-2 shrink-0">
            <Checkbox
              id="show-hidden"
              checked={showHidden}
              onCheckedChange={(checked) => setShowHidden(checked === true)}
            />
            <label
              htmlFor="show-hidden"
              className="text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap"
            >
              Show hidden
            </label>
          </div>
        </div>

        <ColumnView
          columns={columns}
          showHidden={showHidden}
          hiddenVersion={hiddenVersion}
          sshHost={sshHost}
          onSelect={handleColumnSelect}
          fileMode={mode === 'file'}
          selectedPaths={selectedPaths}
          onSelectEntry={mode === 'file' ? handleSelectEntry : undefined}
        />

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" type="button" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={mode === 'file' && selectedPaths.size === 0}
          >
            {mode === 'file' && selectedPaths.size > 0
              ? `Select (${selectedPaths.size})`
              : 'Select'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ColumnResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      let lastX = e.clientX
      const saved = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      setDragging(true)

      const onMove = (ev: PointerEvent) => {
        onDrag(ev.clientX - lastX)
        lastX = ev.clientX
      }
      const onUp = () => {
        document.body.style.userSelect = saved
        setDragging(false)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [onDrag],
  )

  return (
    <div
      className="panel-resize-handle shrink-0 cursor-col-resize"
      data-resize-handle-state={dragging ? 'drag' : undefined}
      onPointerDown={handlePointerDown}
    />
  )
}

function ColumnView({
  columns,
  showHidden,
  hiddenVersion,
  sshHost,
  onSelect,
  fileMode,
  selectedPaths,
  onSelectEntry,
}: {
  columns: Column[]
  showHidden: boolean
  hiddenVersion: number
  sshHost?: string
  onSelect: (colIndex: number, dirName: string) => void
  fileMode?: boolean
  selectedPaths?: Set<string>
  onSelectEntry?: (fullPath: string, metaKey: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [columnWidths, setColumnWidths] = useState<number[]>([])

  // Sync widths array with columns
  useEffect(() => {
    setColumnWidths((prev) => {
      const next = [...prev]
      while (next.length < columns.length) next.push(300)
      return next.slice(0, columns.length)
    })
  }, [columns.length])

  // Auto-scroll rightmost column into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when column count changes
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth
    }
  }, [columns.length])

  const handleDrag = useCallback((colIndex: number, delta: number) => {
    setColumnWidths((prev) => {
      const next = [...prev]
      next[colIndex] = Math.max(150, (next[colIndex] || 300) + delta)
      return next
    })
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex overflow-x-auto h-[70vh] border-t border-b"
    >
      {columns.map((col, i) => (
        <Fragment key={`${col.path}-${hiddenVersion}`}>
          <div
            className="h-full shrink-0"
            style={{ width: columnWidths[i] || 300 }}
          >
            <BrowserColumn
              path={col.path}
              selectedDir={col.selectedDir}
              showHidden={showHidden}
              sshHost={sshHost}
              initialEntries={col.initialEntries}
              initialHasMore={col.initialHasMore}
              onSelectDir={(dirName) => onSelect(i, dirName)}
              fileMode={fileMode}
              selectedPaths={selectedPaths}
              onSelectEntry={onSelectEntry}
            />
          </div>
          <ColumnResizeHandle onDrag={(delta) => handleDrag(i, delta)} />
        </Fragment>
      ))}
    </div>
  )
}

function BrowserColumn({
  path,
  selectedDir,
  showHidden,
  sshHost,
  initialEntries,
  initialHasMore,
  onSelectDir,
  fileMode,
  selectedPaths,
  onSelectEntry,
}: {
  path: string
  selectedDir: string | null
  showHidden: boolean
  sshHost?: string
  initialEntries?: DirEntry[]
  initialHasMore?: boolean
  onSelectDir: (dirName: string) => void
  fileMode?: boolean
  selectedPaths?: Set<string>
  onSelectEntry?: (fullPath: string, metaKey: boolean) => void
}) {
  const [entries, setEntries] = useState<DirEntry[]>(initialEntries ?? [])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(initialHasMore ?? false)
  const [loading, setLoading] = useState(!initialEntries)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch on mount only if no initial data was provided
  // biome-ignore lint/correctness/useExhaustiveDependencies: only fetch when path/hidden/ssh changes and no initial data
  useEffect(() => {
    if (initialEntries) return

    let cancelled = false
    setLoading(true)
    setEntries([])
    setPage(0)
    setHasMore(false)
    setError(null)

    listDirectories([path], 0, showHidden, sshHost)
      .then((res) => {
        if (cancelled) return
        const result = res.results[path]
        if (result?.error) {
          setError(result.error)
        } else if (result?.entries) {
          setEntries(result.entries)
          setHasMore(result.hasMore ?? false)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [path, showHidden, sshHost])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0]?.isIntersecting && hasMore && !loadingMore) {
          const nextPage = page + 1
          setLoadingMore(true)
          listDirectories([path], nextPage, showHidden, sshHost)
            .then((res) => {
              const result = res.results[path]
              if (result?.entries) {
                setEntries((prev) => [...prev, ...result.entries!])
                setHasMore(result.hasMore ?? false)
                setPage(nextPage)
              }
            })
            .finally(() => setLoadingMore(false))
        }
      },
      { root: containerRef.current, threshold: 0.1 },
    )

    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page, path, showHidden, sshHost])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    const isPermissionError = error.startsWith('permission_denied')
    const parentApp = isPermissionError ? error.split(':')[1] || null : null
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6">
        {isPermissionError ? (
          <>
            <ShieldAlert className="w-5 h-5 text-muted-foreground" />
            <div className="text-sm text-muted-foreground text-center">
              {parentApp ? (
                <div>
                  Grant Full Disk Access to{' '}
                  <span className="font-bold">{parentApp}</span> to browse this
                  folder.
                </div>
              ) : (
                'Your terminal app needs Full Disk Access to browse this folder.'
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openFullDiskAccess()}
            >
              Open System Settings
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center">{error}</p>
        )}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Empty</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      {entries.map((entry) => {
        const fullPath =
          path === '/' ? `/${entry.name}` : `${path}/${entry.name}`
        const isSelected = fileMode && selectedPaths?.has(fullPath)

        return (
          <div
            key={entry.name}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm',
              entry.isDir
                ? 'cursor-pointer hover:bg-accent/50'
                : fileMode
                  ? 'cursor-pointer hover:bg-accent/50'
                  : 'cursor-default text-muted-foreground',
              entry.isDir && selectedDir === entry.name && 'bg-accent',
              isSelected && 'bg-accent',
              entry.name.startsWith('.') && 'opacity-50',
            )}
            onClick={(e) => {
              if (entry.isDir) {
                if (fileMode && (e.metaKey || e.ctrlKey) && onSelectEntry) {
                  onSelectEntry(fullPath, true)
                  return
                }
                onSelectDir(entry.name)
              } else if (fileMode && onSelectEntry) {
                onSelectEntry(fullPath, e.metaKey || e.ctrlKey)
              }
            }}
          >
            {entry.isDir ? (
              <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
            ) : (
              <File className="w-4 h-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className="truncate flex-1">{entry.name}</span>
            {entry.isDir && (
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />
            )}
          </div>
        )
      })}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          {loadingMore && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
    </div>
  )
}

function buildPathSegments(inputPath: string): string[] {
  if (inputPath.startsWith('~')) {
    const cleaned = inputPath.replace(/\/+$/, '') || '~'
    if (cleaned === '~') return ['~']

    // ~/code/trashlab -> ["~", "~/code", "~/code/trashlab"]
    const afterTilde = cleaned.slice(1) // "/code/trashlab"
    const parts = afterTilde.split('/').filter(Boolean)
    const segments: string[] = ['~']
    let current = '~'
    for (const part of parts) {
      current += `/${part}`
      segments.push(current)
    }
    return segments
  }

  const cleaned = inputPath.replace(/\/+$/, '') || '/'
  if (cleaned === '/') return ['/']

  const parts = cleaned.split('/').filter(Boolean)
  const segments: string[] = ['/']
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    segments.push(current)
  }
  return segments
}
