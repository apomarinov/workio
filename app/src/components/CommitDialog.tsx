import { GitCommitHorizontal, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/sonner'
import {
  commitChanges,
  discardChanges,
  getChangedFiles,
  getHeadMessage,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ChangedFile, PRCheckStatus } from '../../shared/types'
import { BranchDiffPanel } from './BranchDiffPanel'
import { ConfirmModal } from './ConfirmModal'
import { DiffViewerPanel, type FileListHandle } from './DiffViewerPanel'

// --- CommitDialog (Bottom Sheet) ---

export type CommitSheetState = 'closed' | 'expanded' | 'collapsed'

interface CommitDialogProps {
  state: CommitSheetState
  terminalId: number
  onClose: () => void
  onCollapse: () => void
  onExpand: () => void
  onSuccess?: () => void
  /** When set, shows a read-only diff viewer for the PR instead of commit UI */
  pr?: PRCheckStatus
}

export function CommitDialog({
  state,
  terminalId,
  onClose,
  onCollapse,
  onExpand,
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
  const stateRef = useRef(state)
  stateRef.current = state

  // Entry animation (SessionSearchPanel pattern)
  const [mounted, setMounted] = useState(false)
  const prevStateRef = useRef<CommitSheetState>('closed')
  useEffect(() => {
    if (state !== 'closed' && prevStateRef.current === 'closed') {
      // Just opened — start off-screen, then animate in
      setMounted(false)
      requestAnimationFrame(() => setMounted(true))
    }
    prevStateRef.current = state
  }, [state])

  // Notify keyboard shortcuts hook about commit dialog state
  useEffect(() => {
    if (viewOnly) return
    window.dispatchEvent(
      new CustomEvent('commit-dialog-open', {
        detail: state !== 'closed',
      }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('commit-dialog-open', { detail: false }),
      )
    }
  }, [state, viewOnly])

  // Listen for custom events from global keyboard shortcuts
  useEffect(() => {
    if (state !== 'expanded' || viewOnly) return
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
  }, [state, viewOnly])

  function refreshFiles(autoSelect = true) {
    setLoadingFiles(true)
    getChangedFiles(terminalId, base)
      .then((data) => {
        setChangedFiles(data.files)
        fileListRef.current?.resetSelection(data.files)
        if (data.files.length > 0) {
          if (autoSelect) {
            setSelectedFile(data.files[0].path)
          }
        } else {
          setSelectedFile(null)
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

  // Fetch changed files when opening (not on collapse)
  useEffect(() => {
    if (state === 'closed') {
      // Reset state only when fully closed
      setMessage('')
      setAmend(false)
      setNoVerify(false)
      setChangedFiles([])
      setLoadingFiles(false)
      setSelectedFile(null)
      setHasSelection(false)
      return
    }
    // Only fetch when transitioning from closed (not from collapsed)
    if (prevStateRef.current === 'closed' || prevStateRef.current === state) {
      refreshFiles()
    }
  }, [state, terminalId, base])

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

  // ESC to close when expanded (capture phase)
  useEffect(() => {
    if (state !== 'expanded') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [state, onClose])

  // Cmd/Ctrl+Enter to commit when expanded
  useEffect(() => {
    if (state !== 'expanded' || viewOnly) return
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
  }, [state, viewOnly])

  // Auto-focus textarea when expanding from closed
  useEffect(() => {
    if (state === 'expanded' && !viewOnly) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 350)
      return () => clearTimeout(timer)
    }
  }, [state, viewOnly])

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

  const isExpanded = state === 'expanded' && mounted
  const isCollapsed = state === 'collapsed'

  const fileCount = changedFiles.length

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
    <>
      {/* Backdrop — only when expanded */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
          isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onCollapse}
      />

      {/* Bottom sheet */}
      <div
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex flex-col bg-zinc-900 border-t border-zinc-700 shadow-2xl transition-transform duration-300 ease-in-out mx-auto max-w-[1400px]',
          'h-[100dvh] max-h-none sm:h-[95vh] sm:max-h-[1500px] sm:rounded-t-lg',
          isExpanded && 'translate-y-0',
          isCollapsed && 'translate-y-[calc(100%-48px)]',
          !isExpanded && !isCollapsed && 'translate-y-full',
        )}
      >
        {/* Collapsed bar — always rendered at top, clickable to expand */}
        <button
          type="button"
          onClick={() => {
            if (state === 'collapsed') onExpand()
          }}
          className={cn(
            'flex items-center gap-2 h-12 px-4 flex-shrink-0 text-left transition-colors',
            state === 'collapsed'
              ? 'cursor-pointer hover:bg-zinc-800'
              : 'cursor-default',
          )}
        >
          <GitCommitHorizontal className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200 truncate">
            {viewOnly && pr ? `${pr.prTitle} #${pr.prNumber}` : ''}
          </span>
          {fileCount > 0 && (
            <span className="text-xs text-zinc-500 ml-1">
              {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
          )}
          {message.trim() && !viewOnly && (
            <span className="text-xs text-zinc-500 ml-auto truncate max-w-[200px]">
              {message.trim().split('\n')[0]}
            </span>
          )}
        </button>

        {/* Content area — inert when collapsed */}
        <div
          className="flex-1 min-h-0 flex flex-col overflow-hidden px-2 pb-2 sm:px-4 sm:pb-4"
          {...(state === 'collapsed'
            ? { inert: '' as unknown as boolean }
            : {})}
        >
          {viewOnly && pr ? (
            <>
              <div className="px-2 pb-2 sm:px-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-500 font-mono">
                    {pr.baseBranch} ← {pr.branch}
                  </span>
                </div>
              </div>
              <BranchDiffPanel
                terminalId={terminalId}
                baseBranch={pr.baseBranch}
                headBranch={pr.branch}
                cacheKey={pr.headCommitSha}
              />
            </>
          ) : (
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
          )}

          {!viewOnly && (
            <div className="flex justify-end gap-2 pt-2 flex-shrink-0">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleCommit} disabled={!canCommit || loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {amend ? 'Amend' : 'Commit'}
              </Button>
            </div>
          )}
        </div>
      </div>

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
    </>
  )
}
