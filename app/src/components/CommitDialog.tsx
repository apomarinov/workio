import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  commitChanges,
  discardChanges,
  getChangedFiles,
  getHeadMessage,
} from '@/lib/api'
import type { ChangedFile, PRCheckStatus } from '../../shared/types'
import { ConfirmModal } from './ConfirmModal'
import { DiffViewerPanel, type FileListHandle } from './DiffViewerPanel'

// --- CommitDialog ---

interface CommitDialogProps {
  open: boolean
  terminalId: number
  onClose: () => void
  onSuccess?: () => void
  /** When set, shows a read-only diff viewer for the PR instead of commit UI */
  pr?: PRCheckStatus
}

export function CommitDialog({
  open,
  terminalId,
  onClose,
  onSuccess,
  pr,
}: CommitDialogProps) {
  const viewOnly = !!pr
  const base = pr ? `origin/${pr.baseBranch}...origin/${pr.branch}` : undefined
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [noVerify, setNoVerify] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchingMessage, setFetchingMessage] = useState(false)
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discardFiles, setDiscardFiles] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const handleCommitRef = useRef<() => void>(() => {})
  const canCommitRef = useRef(false)
  const fileListRef = useRef<FileListHandle>(null)

  // Notify keyboard shortcuts hook about commit dialog state
  useEffect(() => {
    if (viewOnly) return
    window.dispatchEvent(
      new CustomEvent('commit-dialog-open', { detail: open }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('commit-dialog-open', { detail: false }),
      )
    }
  }, [open, viewOnly])

  // Listen for custom events from global keyboard shortcuts
  useEffect(() => {
    if (!open || viewOnly) return
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
  }, [open, viewOnly])

  function refreshFiles(autoSelect = true) {
    setLoadingFiles(true)
    getChangedFiles(terminalId, base)
      .then((data) => {
        setChangedFiles(data.files)
        fileListRef.current?.resetSelection(data.files)
        if (autoSelect && data.files.length > 0) {
          setSelectedFile(data.files[0].path)
        }
      })
      .catch((err) => {
        setChangedFiles([])
        toast.error(
          err instanceof Error ? err.message : 'Failed to load changed files',
        )
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
      setLoadingFiles(false)
      setSelectedFile(null)
      setHasSelection(false)
      return
    }

    refreshFiles()
  }, [open, terminalId, base])

  // When amend is toggled on, fetch HEAD message
  useEffect(() => {
    if (!amend || viewOnly) return
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
    if (!open || viewOnly) return
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

  const handleCommit = async () => {
    setLoading(true)
    try {
      const selected = fileListRef.current?.getSelectedFiles() ?? new Set()
      const filesToSend =
        selected.size === changedFiles.length ? undefined : Array.from(selected)
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
      await discardChanges(terminalId, Array.from(discardFiles))
      toast.success(
        `Discarded ${discardFiles.size} file${discardFiles.size > 1 ? 's' : ''}`,
      )
      setConfirmDiscard(false)
      const clearViewer = selectedFile != null && discardFiles.has(selectedFile)
      if (clearViewer) {
        setSelectedFile(null)
      }
      refreshFiles(!clearViewer)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to discard changes',
      )
    } finally {
      setDiscarding(false)
    }
  }

  const canCommit = (amend || !!message.trim()) && hasSelection
  handleCommitRef.current = handleCommit
  canCommitRef.current = canCommit

  const commitControls = !viewOnly ? (
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
  ) : undefined

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="w-[95vw] p-4 sm:max-w-[1500px] h-[95vh] max-h-[1500px] flex flex-col overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          if (!viewOnly) textareaRef.current?.focus()
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className={viewOnly ? '' : 'hidden'}>
          <DialogTitle>
            {viewOnly && pr ? (
              <div className="flex flex-col gap-0.5">
                <span>
                  {pr.prTitle}{' '}
                  <span className="text-zinc-500">#{pr.prNumber}</span>
                </span>
                <span className="text-xs font-normal text-zinc-500 font-mono">
                  {pr.baseBranch} ← {pr.branch}
                </span>
              </div>
            ) : (
              'Commit Changes'
            )}
          </DialogTitle>
        </DialogHeader>

        <DiffViewerPanel
          terminalId={terminalId}
          base={base}
          readOnly={viewOnly}
          commitControls={commitControls}
          onHasSelectionChange={setHasSelection}
          fileListRef={fileListRef}
          loading={loading}
          discarding={discarding}
          onRefresh={() => refreshFiles()}
          onRequestDiscard={(files) => {
            setDiscardFiles(files)
            setConfirmDiscard(true)
          }}
          externalFiles={changedFiles}
          externalLoadingFiles={loadingFiles}
        />

        {!viewOnly && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleCommit} disabled={!canCommit || loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {amend ? 'Amend' : 'Commit'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>

      {!viewOnly && (
        <ConfirmModal
          open={confirmDiscard}
          title="Discard changes?"
          message={`This will permanently discard changes in ${discardFiles.size} file${discardFiles.size > 1 ? 's' : ''}. This action cannot be undone.`}
          confirmLabel="Discard"
          variant="danger"
          onConfirm={handleDiscard}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </Dialog>
  )
}
