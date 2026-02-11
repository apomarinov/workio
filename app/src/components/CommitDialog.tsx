import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { commitChanges, getChangedFiles, getHeadMessage } from '@/lib/api'
import type { ChangedFile, FileStatus } from '../../shared/types'

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
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-mono font-semibold ${config.className}`}
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch changed files on dialog open
  useEffect(() => {
    if (!open) {
      setMessage('')
      setAmend(false)
      setNoVerify(false)
      setChangedFiles([])
      setSelectedFiles(new Set())
      setLoadingFiles(false)
      return
    }

    let cancelled = false
    setLoadingFiles(true)
    getChangedFiles(terminalId)
      .then((data) => {
        if (!cancelled) {
          setChangedFiles(data.files)
          setSelectedFiles(new Set(data.files.map((f) => f.path)))
        }
      })
      .catch(() => {
        if (!cancelled) setChangedFiles([])
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false)
      })
    return () => {
      cancelled = true
    }
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

  const canCommit = (amend || !!message.trim()) && selectedFiles.size > 0

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="sm:max-w-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          textareaRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
          <DialogDescription>
            Select files to stage and create a commit.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <textarea
            ref={textareaRef}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none"
            rows={10}
            placeholder="Commit message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={amend || loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
                handleCommit()
              }
            }}
          />

          {/* File selection list */}
          <div className="rounded-md border border-zinc-700">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/50"
              onClick={toggleAll}
              disabled={loading || loadingFiles || changedFiles.length === 0}
            >
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => toggleAll()}
                disabled={loading || loadingFiles || changedFiles.length === 0}
                className="h-4 w-4"
              />
              <span className="font-medium">
                {allSelected ? 'Deselect all' : 'Select all'}
              </span>
              <span className="text-zinc-500">
                ({selectedFiles.size}/{changedFiles.length} files)
              </span>
            </button>
            <div className="max-h-48 overflow-y-auto border-t border-zinc-700">
              {loadingFiles ? (
                <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading files...
                </div>
              ) : changedFiles.length === 0 ? (
                <div className="py-4 text-center text-sm text-zinc-500">
                  No changed files
                </div>
              ) : (
                changedFiles.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-800/50"
                    onClick={() => toggleFile(file.path)}
                    disabled={loading}
                  >
                    <Checkbox
                      checked={selectedFiles.has(file.path)}
                      onCheckedChange={() => toggleFile(file.path)}
                      disabled={loading}
                      className="h-4 w-4"
                    />
                    <FileStatusBadge status={file.status} />
                    <span className="flex-1 truncate text-left text-zinc-300 font-mono text-xs">
                      {file.path}
                    </span>
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
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Options row */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={amend}
                onCheckedChange={(v) => handleAmendChange(v === true)}
                disabled={loading}
                className="h-5 w-5"
              />
              Amend last commit
              {fetchingMessage && (
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
              )}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={noVerify}
                onCheckedChange={(v) => setNoVerify(v === true)}
                disabled={loading}
                className="h-5 w-5"
              />
              No verify
            </label>
          </div>
        </div>
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
    </Dialog>
  )
}
