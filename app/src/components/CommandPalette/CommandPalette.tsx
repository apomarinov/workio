import { useCallback, useEffect, useMemo, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/sonner'
import { useProcessContext } from '@/context/ProcessContext'
import { useSessionContext } from '@/context/SessionContext'
import { useTerminalContext } from '@/context/TerminalContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  type BranchInfo,
  checkoutBranch,
  getBranches,
  pullBranch,
  pushBranch,
} from '@/lib/api'
import type { PRCheckStatus } from '../../../shared/types'
import type { SessionWithProject, Terminal } from '../../types'
import { ConfirmModal } from '../ConfirmModal'
import { EditSessionModal } from '../EditSessionModal'
import { EditTerminalModal } from '../EditTerminalModal'
import { CommandPaletteCore } from './CommandPaletteCore'
import {
  type AppActions,
  type AppData,
  createPaletteModes,
  type ModeState,
} from './createPaletteModes'
import type { NavigationResult, PaletteAPI } from './types'

export function CommandPalette() {
  // Palette state
  const [open, setOpen] = useState(false)
  const [modeStack, setModeStack] = useState<string[]>(['search'])
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Mode-specific state
  const [selectedTerminal, setSelectedTerminal] = useState<Terminal | null>(
    null,
  )
  const [selectedPR, setSelectedPR] = useState<PRCheckStatus | null>(null)
  const [selectedSession, setSelectedSession] =
    useState<SessionWithProject | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<{
    name: string
    isRemote: boolean
    isCurrent: boolean
  } | null>(null)
  const [branches, setBranches] = useState<{
    local: BranchInfo[]
    remote: BranchInfo[]
  } | null>(null)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [loadingStates, setLoadingStates] = useState<{
    checkingOut?: string
    pulling?: string
    pushing?: { branch: string; force: boolean }
  }>({})

  // Modal state
  const [editTerminal, setEditTerminal] = useState<Terminal | null>(null)
  const [deleteTerminalTarget, setDeleteTerminalTarget] =
    useState<Terminal | null>(null)
  const [deleteDirectory, setDeleteDirectory] = useState(false)
  const [renameSession, setRenameSession] = useState<SessionWithProject | null>(
    null,
  )
  const [deleteSessionTarget, setDeleteSessionTarget] =
    useState<SessionWithProject | null>(null)
  const [forcePushConfirm, setForcePushConfirm] = useState<{
    terminalId: number
    branch: string
  } | null>(null)

  // Context data
  const {
    terminals,
    selectTerminal,
    githubPRs,
    mergedPRs,
    createTerminal,
    updateTerminal,
    deleteTerminal,
  } = useTerminalContext()
  const {
    sessions,
    selectSession,
    clearSession,
    updateSession,
    deleteSession,
  } = useSessionContext()
  const { gitDirtyStatus } = useProcessContext()

  // Pin state (shared localStorage keys with sidebar)
  const [pinnedTerminalSessions, setPinnedTerminalSessions] = useLocalStorage<
    number[]
  >('sidebar-pinned-terminal-sessions', [])
  const [pinnedSessions, setPinnedSessions] = useLocalStorage<string[]>(
    'sidebar-pinned-sessions',
    [],
  )

  // Reset state when palette closes
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
    if (!value) {
      setTimeout(() => {
        setSelectedTerminal(null)
        setSelectedPR(null)
        setSelectedSession(null)
        setSelectedBranch(null)
        setBranches(null)
        setBranchesLoading(false)
        setLoadingStates({})
        setHighlightedId(null)
        setModeStack(['search'])
      }, 300)
    }
  }, [])

  const closePalette = useCallback(() => {
    handleOpenChange(false)
  }, [handleOpenChange])

  // Event listeners
  useEffect(() => {
    const handler = () => {
      setModeStack(['search'])
      setOpen(true)
    }
    window.addEventListener('open-palette', handler)
    return () => window.removeEventListener('open-palette', handler)
  }, [])

  // Build branchToPR map for event handlers
  const branchToPR = useMemo(() => {
    const map = new Map<string, PRCheckStatus>()
    for (const pr of githubPRs) {
      if (pr.state !== 'OPEN' && pr.state !== 'MERGED') continue
      const existing = map.get(pr.branch)
      if (!existing || (existing.state !== 'OPEN' && pr.state === 'OPEN')) {
        map.set(pr.branch, pr)
      }
    }
    return map
  }, [githubPRs])

  // Listen for item-actions event
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number | null; sessionId: string | null }>,
    ) => {
      const { terminalId, sessionId } = e.detail

      if (sessionId) {
        const session = sessions.find((s) => s.session_id === sessionId)
        if (session) {
          setSelectedSession(session)
          setSelectedTerminal(null)
          setSelectedPR(null)
          setModeStack(['search', 'actions'])
          setOpen(true)
          return
        }
      }

      if (terminalId) {
        const terminal = terminals.find((t) => t.id === terminalId)
        if (terminal) {
          const pr = terminal.git_branch
            ? (branchToPR.get(terminal.git_branch) ?? null)
            : null
          setSelectedTerminal(terminal)
          setSelectedPR(pr)
          setSelectedSession(null)
          setModeStack(['search', 'actions'])
          setOpen(true)
        }
      }
    }
    window.addEventListener('open-item-actions', handler as EventListener)
    return () =>
      window.removeEventListener('open-item-actions', handler as EventListener)
  }, [terminals, sessions, branchToPR])

  // Listen for open-terminal-branches event
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      const { terminalId } = e.detail
      const terminal = terminals.find((t) => t.id === terminalId)
      if (terminal?.git_repo) {
        const pr = terminal.git_branch
          ? (branchToPR.get(terminal.git_branch) ?? null)
          : null
        setSelectedTerminal(terminal)
        setSelectedPR(pr)
        setSelectedSession(null)
        setBranches(null)
        setBranchesLoading(true)
        setModeStack(['search', 'actions', 'branches'])
        setOpen(true)
        getBranches(terminalId)
          .then((data) => {
            setBranches(data)
            const firstBranch = data.local[0] ?? data.remote[0]
            if (firstBranch) {
              const prefix = data.local[0] ? 'local' : 'remote'
              setHighlightedId(`branch:${prefix}:${firstBranch.name}`)
            }
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : 'Failed to fetch branches',
            )
          })
          .finally(() => setBranchesLoading(false))
      }
    }
    window.addEventListener('open-terminal-branches', handler as EventListener)
    return () =>
      window.removeEventListener(
        'open-terminal-branches',
        handler as EventListener,
      )
  }, [terminals, branchToPR])

  // Build app data
  const appData: AppData = useMemo(
    () => ({
      terminals,
      sessions,
      githubPRs,
      mergedPRs,
      gitDirtyStatus,
      pinnedTerminalSessions,
      pinnedSessions,
    }),
    [
      terminals,
      sessions,
      githubPRs,
      mergedPRs,
      gitDirtyStatus,
      pinnedTerminalSessions,
      pinnedSessions,
    ],
  )

  // Build mode state
  const modeState: ModeState = useMemo(
    () => ({
      terminal: selectedTerminal,
      session: selectedSession,
      pr: selectedPR,
      branch: selectedBranch,
      branches,
      branchesLoading,
      loadingStates,
    }),
    [
      selectedTerminal,
      selectedSession,
      selectedPR,
      selectedBranch,
      branches,
      branchesLoading,
      loadingStates,
    ],
  )

  // Palette API
  const api: PaletteAPI = useMemo(
    () => ({
      navigate: (result: NavigationResult) => {
        setModeStack((prev) => [...prev, result.modeId])
        setHighlightedId(result.highlightedId ?? null)
      },
      back: () => {
        if (modeStack.length <= 1) return
        setModeStack((prev) => prev.slice(0, -1))
      },
      close: closePalette,
    }),
    [modeStack, closePalette],
  )

  // App actions
  const appActions: AppActions = useMemo(
    () => ({
      // Navigation
      selectTerminal: (id) => {
        selectTerminal(id)
        clearSession()
        closePalette()
        window.dispatchEvent(
          new CustomEvent('reveal-terminal', { detail: { id } }),
        )
      },
      selectSession: (sessionId) => {
        selectSession(sessionId)
        closePalette()
        window.dispatchEvent(
          new CustomEvent('reveal-session', { detail: { sessionId } }),
        )
      },
      revealPR: (pr) => {
        closePalette()
        window.dispatchEvent(
          new CustomEvent('reveal-pr', {
            detail: { branch: pr.branch, repo: pr.repo },
          }),
        )
      },

      // Terminal actions
      openInCursor: (terminal) => {
        window.open(`cursor://file/${terminal.cwd}`, '_blank')
        closePalette()
      },
      openPR: (pr) => {
        window.open(pr.prUrl, '_blank')
        closePalette()
      },
      addWorkspace: async (terminal) => {
        closePalette()
        try {
          const newTerminal = await createTerminal({
            cwd: '~',
            source_terminal_id: terminal.id,
          })
          selectTerminal(newTerminal.id)
          clearSession()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to add workspace',
          )
        }
      },
      openEditModal: (terminal) => {
        closePalette()
        setTimeout(() => setEditTerminal(terminal), 150)
      },
      openDeleteModal: (terminal) => {
        closePalette()
        setDeleteDirectory(false)
        setTimeout(() => setDeleteTerminalTarget(terminal), 150)
      },

      // Session actions
      openRenameModal: (session) => {
        closePalette()
        setTimeout(() => setRenameSession(session), 150)
      },
      openDeleteSessionModal: (session) => {
        closePalette()
        setTimeout(() => setDeleteSessionTarget(session), 150)
      },

      // Pin actions
      toggleTerminalPin: (terminalId) => {
        setPinnedTerminalSessions((prev) =>
          prev.includes(terminalId)
            ? prev.filter((id) => id !== terminalId)
            : [...prev, terminalId],
        )
      },
      toggleSessionPin: (sessionId) => {
        setPinnedSessions((prev) =>
          prev.includes(sessionId)
            ? prev.filter((id) => id !== sessionId)
            : [...prev, sessionId],
        )
      },

      // Branch actions
      loadBranches: (terminalId) => {
        setBranches(null)
        setBranchesLoading(true)
        getBranches(terminalId)
          .then((data) => {
            setBranches(data)
            const firstBranch = data.local[0] ?? data.remote[0]
            if (firstBranch) {
              const prefix = data.local[0] ? 'local' : 'remote'
              setHighlightedId(`branch:${prefix}:${firstBranch.name}`)
            }
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : 'Failed to fetch branches',
            )
          })
          .finally(() => setBranchesLoading(false))
      },
      checkoutBranch: async (name, isRemote) => {
        if (!selectedTerminal) return
        setLoadingStates((s) => ({ ...s, checkingOut: name }))
        try {
          await checkoutBranch(selectedTerminal.id, name, isRemote)
          toast.success(`Switched to ${name}`)
          closePalette()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to checkout branch',
          )
        } finally {
          setLoadingStates((s) => ({ ...s, checkingOut: undefined }))
        }
      },
      pullBranch: async (name) => {
        if (!selectedTerminal) return
        setLoadingStates((s) => ({ ...s, pulling: name }))
        try {
          await pullBranch(selectedTerminal.id, name)
          toast.success(`Pulled ${name}`)
          closePalette()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to pull branch',
          )
        } finally {
          setLoadingStates((s) => ({ ...s, pulling: undefined }))
        }
      },
      pushBranch: async (name, force) => {
        if (!selectedTerminal) return
        setLoadingStates((s) => ({
          ...s,
          pushing: { branch: name, force: !!force },
        }))
        try {
          await pushBranch(selectedTerminal.id, name, force)
          toast.success(force ? `Force pushed ${name}` : `Pushed ${name}`)
          closePalette()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to push branch',
          )
        } finally {
          setLoadingStates((s) => ({ ...s, pushing: undefined }))
        }
      },
      requestForcePush: (terminalId, branch) => {
        setForcePushConfirm({ terminalId, branch })
      },

      // State setters
      setSelectedTerminal: (terminal, pr) => {
        setSelectedTerminal(terminal)
        setSelectedPR(pr)
        setSelectedSession(null)
      },
      setSelectedSession: (session) => {
        setSelectedSession(session)
        setSelectedTerminal(null)
        setSelectedPR(null)
      },
      setSelectedBranch,
    }),
    [
      selectTerminal,
      selectSession,
      clearSession,
      closePalette,
      createTerminal,
      setPinnedTerminalSessions,
      setPinnedSessions,
      selectedTerminal,
    ],
  )

  // Create modes
  const modes = useMemo(
    () => createPaletteModes(appData, modeState, appActions, api),
    [appData, modeState, appActions, api],
  )

  const currentModeId = modeStack[modeStack.length - 1]

  // Handle back navigation with highlight restoration
  const handleBack = useCallback(() => {
    if (modeStack.length <= 1) return
    const currentMode = modes[currentModeId]
    const backResult = currentMode?.onBack?.()
    if (backResult) {
      setModeStack((prev) => prev.slice(0, -1))
      setHighlightedId(backResult.highlightedId ?? null)

      // Clear state based on which mode we're leaving
      if (currentModeId === 'actions') {
        setSelectedTerminal(null)
        setSelectedPR(null)
        setSelectedSession(null)
      } else if (currentModeId === 'branches') {
        setBranches(null)
      } else if (currentModeId === 'branch-actions') {
        setSelectedBranch(null)
      }
    } else {
      setModeStack((prev) => prev.slice(0, -1))
    }
  }, [modeStack, modes, currentModeId])

  return (
    <>
      <CommandPaletteCore
        open={open}
        onOpenChange={handleOpenChange}
        modes={modes}
        currentModeId={currentModeId}
        highlightedId={highlightedId}
        onHighlightChange={setHighlightedId}
        onBack={handleBack}
      />

      {editTerminal && (
        <EditTerminalModal
          open={!!editTerminal}
          terminal={editTerminal}
          onSave={async (updates) => {
            try {
              await updateTerminal(editTerminal.id, updates)
              setEditTerminal(null)
            } catch (err) {
              toast.error(
                err instanceof Error
                  ? err.message
                  : 'Failed to update terminal',
              )
            }
          }}
          onCancel={() => setEditTerminal(null)}
        />
      )}

      {deleteTerminalTarget && (
        <ConfirmModal
          open={!!deleteTerminalTarget}
          title="Delete Project"
          message={`Are you sure you want to delete "${deleteTerminalTarget.name || deleteTerminalTarget.cwd}"?`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            deleteTerminal(deleteTerminalTarget.id, { deleteDirectory })
            setDeleteTerminalTarget(null)
          }}
          onCancel={() => setDeleteTerminalTarget(null)}
        >
          {deleteTerminalTarget.git_repo && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={deleteDirectory}
                onCheckedChange={(v) => setDeleteDirectory(v === true)}
                className="w-5 h-5"
              />
              Also delete workspace directory
            </label>
          )}
        </ConfirmModal>
      )}

      {renameSession && (
        <EditSessionModal
          open={!!renameSession}
          currentName={renameSession.name ?? ''}
          onSave={async (name) => {
            try {
              await updateSession(renameSession.session_id, { name })
              setRenameSession(null)
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : 'Failed to rename session',
              )
            }
          }}
          onCancel={() => setRenameSession(null)}
        />
      )}

      {deleteSessionTarget && (
        <ConfirmModal
          open={!!deleteSessionTarget}
          title="Delete Session"
          message="Are you sure you want to delete this session?"
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            deleteSession(deleteSessionTarget.session_id)
            setDeleteSessionTarget(null)
          }}
          onCancel={() => setDeleteSessionTarget(null)}
        />
      )}

      {forcePushConfirm && (
        <ConfirmModal
          open={!!forcePushConfirm}
          title="Force Push"
          message={`Are you sure you want to force push "${forcePushConfirm.branch}"? This will overwrite the remote branch history.`}
          confirmLabel="Force Push"
          variant="danger"
          onConfirm={() => {
            appActions.pushBranch(forcePushConfirm.branch, true)
            setForcePushConfirm(null)
          }}
          onCancel={() => setForcePushConfirm(null)}
        />
      )}
    </>
  )
}
