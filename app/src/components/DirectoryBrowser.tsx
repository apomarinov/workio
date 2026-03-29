import type { FavoriteFolder } from '@domains/settings/schema'
import type { DirEntry } from '@domains/workspace/schema/system'
import {
  ChevronRight,
  File,
  Folder,
  FolderPlus,
  Github,
  Loader2,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '@/hooks/useSettings'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

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
}

export function DirectoryBrowser({
  open,
  onOpenChange,
  value,
  onSelect,
  sshHost,
  mode = 'directory',
  onSelectPaths,
}: DirectoryBrowserProps) {
  const { settings, updateSettings } = useSettings()
  const listDirsMutation = trpc.workspace.system.listDirectories.useMutation()
  const createDirMutation = trpc.workspace.system.createDirectory.useMutation()

  const [columns, setColumns] = useState<Column[]>([])
  const [inputPath, setInputPath] = useState('')
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [hiddenVersion, setHiddenVersion] = useState(0)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)

  const defaultRoot = '~'

  // Initialize columns when dialog opens

  useEffect(() => {
    if (!open) return
    if (value) {
      navigateToPath(value)
    } else {
      setColumns([{ path: defaultRoot, selectedDir: null }])
      setInputPath(defaultRoot)
    }
  }, [open])

  useEffect(() => {
    setHiddenVersion((v) => v + 1)
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        initialEntries: undefined,
        initialHasMore: undefined,
      })),
    )
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
        const res = await listDirsMutation.mutateAsync({
          paths: segments,
          page: 0,
          hidden: showHidden,
          ssh_host: sshHost,
        })

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
        toast.error('Failed to load directory')
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
    },
    [mode],
  )

  const handleColumnBackground = useCallback((colIndex: number) => {
    setColumns((prev) => {
      const updated = prev.slice(0, colIndex + 1)
      updated[colIndex] = { ...updated[colIndex], selectedDir: null }
      setInputPath(updated[colIndex].path)
      return updated
    })
  }, [])

  const handleSelectEntry = useCallback(
    (
      fullPath: string,
      metaKey: boolean,
      shiftKey: boolean,
      columnEntries: DirEntry[],
      columnPath: string,
    ) => {
      setSelectedPaths((prev) => {
        if (shiftKey && prev.size > 0) {
          const columnPaths = columnEntries.map((e) =>
            columnPath === '/' ? `/${e.name}` : `${columnPath}/${e.name}`,
          )
          const selectedIndices = columnPaths
            .map((p, i) => (prev.has(p) ? i : -1))
            .filter((i) => i !== -1)

          if (selectedIndices.length === 0) {
            return new Set([fullPath])
          }

          const clickedIndex = columnPaths.indexOf(fullPath)
          if (clickedIndex === -1) return prev

          const minSelected = Math.min(...selectedIndices)
          const maxSelected = Math.max(...selectedIndices)

          let rangeStart: number
          let rangeEnd: number
          if (clickedIndex >= maxSelected) {
            rangeStart = minSelected
            rangeEnd = clickedIndex
          } else if (clickedIndex <= minSelected) {
            rangeStart = clickedIndex
            rangeEnd = maxSelected
          } else {
            rangeStart = minSelected
            rangeEnd = clickedIndex
          }

          const next = new Set(prev)
          for (let i = rangeStart; i <= rangeEnd; i++) {
            next.add(columnPaths[i])
          }
          return next
        }

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

  const hostKey = sshHost ?? 'local'
  const favorites = settings.favorite_folders ?? []
  const isFavorite = favorites.some(
    (f) => f.host === hostKey && f.path === inputPath,
  )

  const handleSaveFavorite = async () => {
    if (isFavorite || !inputPath.trim()) return
    const updated = [...favorites, { host: hostKey, path: inputPath.trim() }]
    try {
      await updateSettings({ favorite_folders: updated })
      toast.success('Folder saved to favorites')
    } catch (err) {
      toastError(err, 'Failed to save favorite')
    }
  }

  const handleRemoveFavorite = async (fav: FavoriteFolder) => {
    const updated = favorites.filter(
      (f) => !(f.host === fav.host && f.path === fav.path),
    )
    try {
      await updateSettings({ favorite_folders: updated })
      toast.success('Folder removed from favorites')
    } catch (err) {
      toastError(err, 'Failed to remove favorite')
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName?.trim()) return
    const name = newFolderName.trim()
    setCreatingFolder(true)
    try {
      const result = await createDirMutation.mutateAsync({
        path: inputPath || defaultRoot,
        name,
        ssh_host: sshHost,
      })
      setNewFolderName(null)
      setHiddenVersion((v) => v + 1)
      navigateToPath(result.path)
    } catch (err) {
      toastError(err, 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-sidebar sm:max-w-[95vw] max-h-[calc(85vh-env(safe-area-inset-top))] p-0 gap-0 flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-3 justify-between">
            <div className="flex-1 flex items-center w-full">
              <Folder className="w-4 h-4 shrink-0 text-muted-foreground mr-2" />
              <Popover open={favoritesOpen} onOpenChange={setFavoritesOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Star
                      className={cn(
                        'w-4 h-4',
                        isFavorite && 'fill-yellow-400 text-yellow-400',
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="min-w-72 w-fit max-w-[500px] p-0"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <button
                    type="button"
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm border-b flex items-center gap-2',
                      isFavorite
                        ? 'text-muted-foreground cursor-default'
                        : 'hover:bg-accent cursor-pointer',
                    )}
                    onClick={() => {
                      handleSaveFavorite()
                      setFavoritesOpen(false)
                    }}
                    disabled={isFavorite}
                  >
                    <Star className="w-3.5 h-3.5 shrink-0" />
                    {isFavorite ? 'Already saved' : 'Save current folder'}
                  </button>
                  {favorites.filter((f) => f.host === hostKey).length > 0 ? (
                    <div className="max-h-48 overflow-y-auto">
                      {favorites
                        .filter((f) => f.host === hostKey)
                        .map((fav) => (
                          <div
                            key={fav.path}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent group cursor-pointer"
                            onClick={() => {
                              navigateToPath(fav.path)
                              setFavoritesOpen(false)
                            }}
                          >
                            <Folder className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            <span className="break-all flex-1 max-w-full text-xs font-mono">
                              {fav.path}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveFavorite(fav)
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                      No favorites yet
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <Input
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={defaultRoot}
                className="flex-1 font-mono text-sm max-w-1/2 h-7 px-2 !bg-transparent !border-none"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Checkbox
                id="show-hidden"
                checked={showHidden}
                onCheckedChange={(checked) => setShowHidden(checked === true)}
              />
              <label
                htmlFor="show-hidden"
                className="text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap font-normal"
              >
                Show hidden
              </label>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ColumnView
          columns={columns}
          showHidden={showHidden}
          hiddenVersion={hiddenVersion}
          sshHost={sshHost}
          onSelect={handleColumnSelect}
          onSelectColumn={handleColumnBackground}
          fileMode={mode === 'file'}
          selectedPaths={selectedPaths}
          onSelectEntry={mode === 'file' ? handleSelectEntry : undefined}
          onConfirmEntry={
            mode === 'file'
              ? (fullPath: string) => {
                  if (onSelectPaths) {
                    const paths = selectedPaths.has(fullPath)
                      ? Array.from(selectedPaths)
                      : [fullPath]
                    onSelectPaths(paths)
                    onOpenChange(false)
                  }
                }
              : undefined
          }
        />

        <DialogFooter className="px-6 py-4 border-t">
          {newFolderName != null ? (
            <div className="flex items-center gap-2 mr-auto">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreateFolder()
                  } else if (e.key === 'Escape') {
                    setNewFolderName(null)
                  }
                }}
                placeholder="Folder name"
                className="w-48 font-mono text-sm h-9"
                disabled={creatingFolder}
              />
              <Button
                size="sm"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creatingFolder}
              >
                {creatingFolder ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  'Create'
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNewFolderName(null)}
                disabled={creatingFolder}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              type="button"
              className="mr-auto"
              onClick={() => setNewFolderName('')}
            >
              <FolderPlus className="w-4 h-4 mr-1.5" />
              New Folder
            </Button>
          )}
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
  onSelectColumn,
  fileMode,
  selectedPaths,
  onSelectEntry,
  onConfirmEntry,
}: {
  columns: Column[]
  showHidden: boolean
  hiddenVersion: number
  sshHost?: string
  onSelect: (colIndex: number, dirName: string) => void
  onSelectColumn: (colIndex: number) => void
  fileMode?: boolean
  selectedPaths?: Set<string>
  onSelectEntry?: (
    fullPath: string,
    metaKey: boolean,
    shiftKey: boolean,
    columnEntries: DirEntry[],
    columnPath: string,
  ) => void
  onConfirmEntry?: (fullPath: string) => void
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
              onClickBackground={() => onSelectColumn(i)}
              fileMode={fileMode}
              selectedPaths={selectedPaths}
              onSelectEntry={onSelectEntry}
              onConfirmEntry={onConfirmEntry}
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
  onClickBackground,
  fileMode,
  selectedPaths,
  onSelectEntry,
  onConfirmEntry,
}: {
  path: string
  selectedDir: string | null
  showHidden: boolean
  sshHost?: string
  initialEntries?: DirEntry[]
  initialHasMore?: boolean
  onSelectDir: (dirName: string) => void
  onClickBackground: () => void
  fileMode?: boolean
  selectedPaths?: Set<string>
  onSelectEntry?: (
    fullPath: string,
    metaKey: boolean,
    shiftKey: boolean,
    columnEntries: DirEntry[],
    columnPath: string,
  ) => void
  onConfirmEntry?: (fullPath: string) => void
}) {
  const listDirsMutation = trpc.workspace.system.listDirectories.useMutation()
  const openFdaMutation = trpc.workspace.system.openFullDiskAccess.useMutation()

  const [entries, setEntries] = useState<DirEntry[]>(initialEntries ?? [])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(initialHasMore ?? false)
  const [loading, setLoading] = useState(!initialEntries)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch on mount only if no initial data was provided

  useEffect(() => {
    if (initialEntries) return

    let cancelled = false
    setLoading(true)
    setEntries([])
    setPage(0)
    setHasMore(false)
    setError(null)

    listDirsMutation
      .mutateAsync({
        paths: [path],
        page: 0,
        hidden: showHidden,
        ssh_host: sshHost,
      })
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
          listDirsMutation
            .mutateAsync({
              paths: [path],
              page: nextPage,
              hidden: showHidden,
              ssh_host: sshHost,
            })
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
              onClick={() => openFdaMutation.mutate()}
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
      <div
        className="h-full flex items-center justify-center cursor-pointer"
        onClick={onClickBackground}
      >
        <p className="text-sm text-muted-foreground pointer-events-none">
          Empty
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClickBackground()
      }}
    >
      {entries.map((entry) => {
        const fullPath =
          path === '/' ? `/${entry.name}` : `${path}/${entry.name}`
        const isSelected = fileMode && selectedPaths?.has(fullPath)

        return (
          <div
            key={entry.name}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm select-none',
              entry.isDir
                ? 'cursor-pointer hover:bg-accent/50'
                : fileMode
                  ? 'cursor-pointer hover:bg-accent/50'
                  : 'cursor-default text-muted-foreground',
              entry.isDir && selectedDir === entry.name && 'bg-accent',
              isSelected && 'bg-blue-500/50 hover:bg-blue-500/60',
              entry.name.startsWith('.') && 'opacity-50',
            )}
            onClick={(e) => {
              if (entry.isDir) {
                if (fileMode && onSelectEntry) {
                  onSelectEntry(
                    fullPath,
                    e.metaKey || e.ctrlKey,
                    e.shiftKey,
                    entries,
                    path,
                  )
                }
                onSelectDir(entry.name)
              } else if (fileMode && onSelectEntry) {
                onSelectEntry(
                  fullPath,
                  e.metaKey || e.ctrlKey,
                  e.shiftKey,
                  entries,
                  path,
                )
              }
            }}
            onDoubleClick={() => {
              if (fileMode && onConfirmEntry) {
                onConfirmEntry(fullPath)
              }
            }}
          >
            {entry.isDir ? (
              <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
            ) : (
              <File className="w-4 h-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className="truncate flex-1">{entry.name}</span>
            {entry.isGit && (
              <Github className="w-3 h-3 shrink-0 text-blue-400" />
            )}
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
