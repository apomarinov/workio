import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/sonner'
import { useProcessContext } from '@/context/ProcessContext'
import { useSessionContext } from '@/context/SessionContext'
import { useTerminalContext } from '@/context/TerminalContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useSettings } from '@/hooks/useSettings'
import { useSocket } from '@/hooks/useSocket'
import {
  checkoutBranch,
  closePR,
  createBranch,
  deleteBranch,
  getBranches,
  openInExplorer,
  openInIDE,
  pullBranch,
  pushBranch,
  rebaseBranch,
  renameBranch,
  renamePR,
  searchSessionMessages,
  toggleFavoriteSession,
} from '@/lib/api'
import type { PRCheckStatus } from '../../../shared/types'
import type {
  SessionSearchMatch,
  SessionWithProject,
  Terminal,
} from '../../types'

const CommitDialog = lazy(() =>
  import('../CommitDialog').then((m) => ({ default: m.CommitDialog })),
)

import { ConfirmModal } from '../ConfirmModal'
import { CreateBranchDialog } from '../CreateBranchDialog'
import { DirectoryBrowser } from '../DirectoryBrowser'
import { RenameModal } from '../EditSessionModal'
import { EditTerminalModal } from '../EditTerminalModal'
import { MergePRModal } from '../MergePRModal'
import { RerunChecksModal } from '../RerunChecksModal'
import { CommandPaletteCore } from './CommandPaletteCore'
import {
  type AppActions,
  type AppData,
  createPaletteModes,
  getLastPathSegment,
} from './createPaletteModes'
import type { PaletteAPI, PaletteLevel } from './types'

const initialLevel: PaletteLevel = { mode: 'search', title: '' }

export function CommandPalette() {
  // Single stack state replaces modeStack + all mode-specific state
  const [open, setOpen] = useState(false)
  const [stack, setStack] = useState<PaletteLevel[]>([initialLevel])

  // Modal state (not navigation-related, stays separate)
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
  const [deleteBranchConfirm, setDeleteBranchConfirm] = useState<{
    terminalId: number
    branch: string
    hasRemote: boolean
  } | null>(null)
  const [deleteRemoteBranch, setDeleteRemoteBranch] = useState(false)

  // PR action modals
  const [mergeModal, setMergeModal] = useState<PRCheckStatus | null>(null)
  const [closeModal, setCloseModal] = useState<PRCheckStatus | null>(null)
  const [rerunAllModal, setRerunAllModal] = useState<PRCheckStatus | null>(null)
  const [filePickerTerminal, setFilePickerTerminal] = useState<Terminal | null>(
    null,
  )
  const [commitTerminalId, setCommitTerminalId] = useState<number | null>(null)
  const [renamePRTarget, setRenamePRTarget] = useState<PRCheckStatus | null>(
    null,
  )
  const [renameBranchTarget, setRenameBranchTarget] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  const [createBranchFrom, setCreateBranchFrom] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  const [createBranchLoading, setCreateBranchLoading] = useState(false)

  // Session search state
  const [searchText, setSearchText] = useState('')
  const [sessionSearchResults, setSessionSearchResults] = useState<
    SessionSearchMatch[] | null
  >(null)
  const [sessionSearchLoading, setSessionSearchLoading] = useState(false)
  const searchAbortRef = useRef<AbortController | null>(null)

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
    refetch: refetchSessions,
  } = useSessionContext()
  const { gitDirtyStatus } = useProcessContext()
  const { settings, updateSettings } = useSettings()
  const { emit } = useSocket()

  // Pin state (shared localStorage keys with sidebar)
  const [pinnedTerminalSessions, setPinnedTerminalSessions] = useLocalStorage<
    number[]
  >('sidebar-pinned-terminal-sessions', [])
  const [pinnedSessions, setPinnedSessions] = useLocalStorage<string[]>(
    'sidebar-pinned-sessions',
    [],
  )

  // Derived values from stack
  const currentLevel = stack[stack.length - 1]
  const currentModeId = currentLevel.mode
  const highlightedId = currentLevel.highlightedId ?? null
  const breadcrumbs = stack
    .slice(1)
    .map((l) => l.title)
    .filter(Boolean)

  // Reset state when palette closes
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
    if (!value) {
      setTimeout(() => {
        setStack([initialLevel])
      }, 300)
    }
  }, [])

  const closePalette = useCallback(() => {
    handleOpenChange(false)
  }, [handleOpenChange])

  // Event listeners
  useEffect(() => {
    const handler = () => {
      setStack([initialLevel])
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
      e: CustomEvent<{
        terminalId: number | null
        sessionId: string | null
        prNumber?: number
        prRepo?: string
      }>,
    ) => {
      const { terminalId, sessionId, prNumber, prRepo } = e.detail

      // If a PR is specified, open PR actions
      if (prNumber && prRepo) {
        const pr = githubPRs.find(
          (p) => p.prNumber === prNumber && p.repo === prRepo,
        )
        if (pr) {
          setStack([
            initialLevel,
            { mode: 'pr-actions', title: pr.prTitle, pr },
          ])
          setOpen(true)
          return
        }
      }

      if (sessionId) {
        const session = sessions.find((s) => s.session_id === sessionId)
        const terminal = terminals.find((t) => t.id === terminalId)
        if (session) {
          const sessionName = terminal?.name ?? session.name ?? 'Untitled'
          setStack([
            initialLevel,
            {
              mode: 'actions',
              title: sessionName,
              session,
            },
          ])
          setOpen(true)
          return
        }
      }

      if (terminalId) {
        const terminal = terminals.find((t) => t.id === terminalId)
        if (terminal) {
          const pr = terminal.git_branch
            ? (branchToPR.get(terminal.git_branch) ?? undefined)
            : undefined
          setStack([
            initialLevel,
            {
              mode: 'actions',
              title: terminal.name || getLastPathSegment(terminal.cwd),
              terminal,
              pr,
            },
          ])
          setOpen(true)
        }
      }
    }
    window.addEventListener('open-item-actions', handler as EventListener)
    return () =>
      window.removeEventListener('open-item-actions', handler as EventListener)
  }, [terminals, sessions, githubPRs, branchToPR])

  // Listen for open-terminal-branches event
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      const { terminalId } = e.detail
      const terminal = terminals.find((t) => t.id === terminalId)
      if (terminal?.git_repo) {
        const pr = terminal.git_branch
          ? (branchToPR.get(terminal.git_branch) ?? undefined)
          : undefined
        setStack([
          initialLevel,
          {
            mode: 'actions',
            title: terminal.name || getLastPathSegment(terminal.cwd),
            terminal,
            pr,
          },
          {
            mode: 'branches',
            title: 'Branches',
            terminal,
            pr,
            branchesLoading: true,
          },
        ])
        setOpen(true)
        getBranches(terminalId)
          .then((data) => {
            setStack((prev) => {
              const current = prev[prev.length - 1]
              if (current.mode !== 'branches') return prev
              const firstBranch = data.local[0] ?? data.remote[0]
              const prefix = data.local[0] ? 'local' : 'remote'
              return [
                ...prev.slice(0, -1),
                {
                  ...current,
                  branches: data,
                  branchesLoading: false,
                  highlightedId: firstBranch
                    ? `branch:${prefix}:${firstBranch.name}`
                    : undefined,
                },
              ]
            })
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : 'Failed to fetch branches',
            )
            setStack((prev) => {
              const current = prev[prev.length - 1]
              if (current.mode !== 'branches') return prev
              return [
                ...prev.slice(0, -1),
                { ...current, branchesLoading: false },
              ]
            })
          })
      }
    }
    window.addEventListener('open-terminal-branches', handler as EventListener)
    return () =>
      window.removeEventListener(
        'open-terminal-branches',
        handler as EventListener,
      )
  }, [terminals, branchToPR])

  // Debounced session search
  useEffect(() => {
    if (currentModeId !== 'session-search' || searchText.length < 2) {
      setSessionSearchResults(null)
      setSessionSearchLoading(false)
      return
    }
    setSessionSearchLoading(true)
    const timer = setTimeout(() => {
      searchAbortRef.current?.abort()
      const controller = new AbortController()
      searchAbortRef.current = controller
      searchSessionMessages(searchText, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) {
            setSessionSearchResults(results)
            setSessionSearchLoading(false)
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            if (err instanceof Error && err.name !== 'AbortError') {
              setSessionSearchLoading(false)
              toast.error(err.message || 'Failed to search sessions')
            }
          }
        })
    }, 500)
    return () => {
      clearTimeout(timer)
      searchAbortRef.current?.abort()
    }
  }, [searchText, currentModeId])

  // Reset search state when palette closes or mode changes (input remounts via key)
  useEffect(() => {
    // Reference deps so the effect re-runs on open/mode changes
    void open
    void currentModeId
    setSearchText('')
    setSessionSearchResults(null)
    setSessionSearchLoading(false)
  }, [open, currentModeId])

  // Build app data
  const preferredIDE = settings?.preferred_ide ?? 'cursor'
  const appData: AppData = useMemo(
    () => ({
      terminals,
      sessions,
      githubPRs,
      mergedPRs,
      gitDirtyStatus,
      pinnedTerminalSessions,
      pinnedSessions,
      preferredIDE,
      sessionSearchResults,
      sessionSearchLoading,
      sessionSearchQuery: searchText,
    }),
    [
      terminals,
      sessions,
      githubPRs,
      mergedPRs,
      gitDirtyStatus,
      pinnedTerminalSessions,
      pinnedSessions,
      preferredIDE,
      sessionSearchResults,
      sessionSearchLoading,
      searchText,
    ],
  )

  // Palette API
  const api: PaletteAPI = useMemo(
    () => ({
      push: (level) => {
        setStack((prev) => [...prev, level])
      },
      pop: () => {
        setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
      },
      updateLevel: (updater) => {
        setStack((prev) => {
          const current = prev[prev.length - 1]
          return [...prev.slice(0, -1), updater(current)]
        })
      },
      close: closePalette,
    }),
    [closePalette],
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
      openInIDE: async (terminal) => {
        closePalette()
        try {
          await openInIDE(terminal.cwd, preferredIDE)
        } catch {
          // CLI not available — fall back to URL scheme
          window.open(`${preferredIDE}://file/${terminal.cwd}`, '_blank')
        }
      },
      openInExplorer: async (terminal) => {
        try {
          await openInExplorer(terminal.cwd)
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to open file explorer',
          )
        }
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
      resumeSession: (session) => {
        closePalette()
        if (session.terminal_id) {
          selectTerminal(session.terminal_id)
          clearSession()
          window.dispatchEvent(
            new CustomEvent('reveal-terminal', {
              detail: { id: session.terminal_id },
            }),
          )
          emit('resume-session', {
            terminalId: session.terminal_id,
            sessionId: session.session_id,
          })
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('terminal-focus', {
                detail: { terminalId: session.terminal_id },
              }),
            )
          }, 350)
        }
      },
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
      toggleFavoriteSession: async (sessionId) => {
        try {
          await toggleFavoriteSession(sessionId)
          refetchSessions()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to toggle favorite',
          )
        }
      },

      // Branch actions
      loadBranches: (terminalId) => {
        getBranches(terminalId)
          .then((data) => {
            setStack((prev) => {
              const current = prev[prev.length - 1]
              if (
                current.mode !== 'branches' &&
                current.mode !== 'branch-actions'
              )
                return prev
              const updates: Partial<PaletteLevel> = {
                branches: data,
                branchesLoading: false,
              }
              if (current.mode === 'branches') {
                const firstBranch = data.local[0] ?? data.remote[0]
                const prefix = data.local[0] ? 'local' : 'remote'
                updates.highlightedId = firstBranch
                  ? `branch:${prefix}:${firstBranch.name}`
                  : undefined
              }
              return [...prev.slice(0, -1), { ...current, ...updates }]
            })
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : 'Failed to fetch branches',
            )
            setStack((prev) => {
              const current = prev[prev.length - 1]
              if (
                current.mode !== 'branches' &&
                current.mode !== 'branch-actions'
              )
                return prev
              return [
                ...prev.slice(0, -1),
                { ...current, branchesLoading: false },
              ]
            })
          })
      },
      checkoutBranch: async (name, isRemote) => {
        const terminal = currentLevel.terminal
        if (!terminal) return
        api.updateLevel((l) => ({
          ...l,
          loadingStates: { ...l.loadingStates, checkingOut: name },
        }))
        try {
          await checkoutBranch(terminal.id, name, isRemote)
          toast.success(`Switched to ${name}`)
          closePalette()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to checkout branch',
          )
        } finally {
          api.updateLevel((l) => ({
            ...l,
            loadingStates: { ...l.loadingStates, checkingOut: undefined },
          }))
        }
      },
      pullBranch: async (name) => {
        const terminal = currentLevel.terminal
        if (!terminal) return
        api.updateLevel((l) => ({
          ...l,
          loadingStates: { ...l.loadingStates, pulling: name },
        }))
        try {
          await pullBranch(terminal.id, name)
          toast.success(`Pulled ${name}`)
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to pull branch',
          )
        } finally {
          api.updateLevel((l) => ({
            ...l,
            loadingStates: { ...l.loadingStates, pulling: undefined },
          }))
        }
      },
      pushBranch: async (name, force) => {
        const terminal = currentLevel.terminal
        if (!terminal) return
        api.updateLevel((l) => ({
          ...l,
          loadingStates: {
            ...l.loadingStates,
            pushing: { branch: name, force: !!force },
          },
        }))
        try {
          await pushBranch(terminal.id, name, force)
          toast.success(force ? `Force pushed ${name}` : `Pushed ${name}`)
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to push branch',
          )
        } finally {
          api.updateLevel((l) => ({
            ...l,
            loadingStates: { ...l.loadingStates, pushing: undefined },
          }))
        }
      },
      requestForcePush: (terminalId, branch) => {
        setForcePushConfirm({ terminalId, branch })
      },
      rebaseBranch: async (name) => {
        const terminal = currentLevel.terminal
        if (!terminal) return
        api.updateLevel((l) => ({
          ...l,
          loadingStates: { ...l.loadingStates, rebasing: name },
        }))
        try {
          const result = await rebaseBranch(terminal.id, name)
          toast.success(`Rebased ${name} onto ${result.onto}`)
          closePalette()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to rebase branch',
          )
        } finally {
          api.updateLevel((l) => ({
            ...l,
            loadingStates: { ...l.loadingStates, rebasing: undefined },
          }))
        }
      },
      requestDeleteBranch: (terminalId, branch, hasRemote) => {
        setDeleteRemoteBranch(false)
        setDeleteBranchConfirm({ terminalId, branch, hasRemote })
      },
      requestCommit: (terminalId) => {
        closePalette()
        setTimeout(() => setCommitTerminalId(terminalId), 150)
      },
      requestCreateBranch: (terminalId, branch) => {
        closePalette()
        setTimeout(() => setCreateBranchFrom({ terminalId, branch }), 150)
      },
      requestRenameBranch: (terminalId, branch) => {
        closePalette()
        setTimeout(() => setRenameBranchTarget({ terminalId, branch }), 150)
      },

      // PR actions
      openMergeModal: (pr) => {
        setMergeModal(pr)
      },
      openCloseModal: (pr) => {
        closePalette()
        setTimeout(() => setCloseModal(pr), 150)
      },
      openRenamePRModal: (pr) => {
        closePalette()
        setTimeout(() => setRenamePRTarget(pr), 150)
      },
      openRerunAllModal: (pr) => {
        setRerunAllModal(pr)
      },
      checkoutPRBranch: async (terminalId, branch) => {
        api.updateLevel((l) => ({
          ...l,
          loadingStates: {
            ...l.loadingStates,
            checkingOut: `${terminalId}:${branch}`,
          },
        }))
        try {
          await checkoutBranch(terminalId, branch, true)
          toast.success(`Checked out ${branch}`)
          closePalette()
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to checkout branch',
          )
        } finally {
          api.updateLevel((l) => ({
            ...l,
            loadingStates: { ...l.loadingStates, checkingOut: undefined },
          }))
        }
      },
      hidePR: async (pr) => {
        try {
          const current = settings?.hidden_prs ?? []
          const updated = [
            ...current,
            { repo: pr.repo, prNumber: pr.prNumber, title: pr.prTitle },
          ]
          await updateSettings({ hidden_prs: updated })
          toast.success(`Hidden PR #${pr.prNumber}`)
          closePalette()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to hide PR')
        }
      },

      // Shell actions
      openFilePicker: (terminal) => {
        closePalette()
        setTimeout(() => setFilePickerTerminal(terminal), 150)
      },
    }),
    [
      selectTerminal,
      selectSession,
      clearSession,
      closePalette,
      createTerminal,
      setPinnedTerminalSessions,
      setPinnedSessions,
      currentLevel,
      api,
      preferredIDE,
      settings,
      updateSettings,
      refetchSessions,
      emit,
    ],
  )

  // Create modes
  const modes = useMemo(
    () => createPaletteModes(appData, currentLevel, appActions, api),
    [appData, currentLevel, appActions, api],
  )

  // Handle back navigation - just pop the stack
  const handleBack = useCallback(() => {
    if (stack.length <= 1) return
    setStack((prev) => prev.slice(0, -1))
  }, [stack.length])

  // Handle clicking on a breadcrumb to navigate to that level
  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      // Breadcrumb at index i corresponds to stack[i + 1]
      // (index 0 in stack is root 'search' which has no breadcrumb)
      const targetStackLength = index + 2
      if (targetStackLength >= stack.length) return
      setStack((prev) => prev.slice(0, targetStackLength))
    },
    [stack.length],
  )

  // Handle highlight changes
  const handleHighlightChange = useCallback((id: string | null) => {
    setStack((prev) => {
      const current = prev[prev.length - 1]
      return [
        ...prev.slice(0, -1),
        { ...current, highlightedId: id ?? undefined },
      ]
    })
  }, [])

  return (
    <>
      <CommandPaletteCore
        open={open}
        onOpenChange={handleOpenChange}
        modes={modes}
        currentModeId={currentModeId}
        breadcrumbs={breadcrumbs}
        highlightedId={highlightedId}
        onHighlightChange={handleHighlightChange}
        onBack={handleBack}
        onBreadcrumbClick={handleBreadcrumbClick}
        onSearchChange={setSearchText}
      />

      {editTerminal && (
        <EditTerminalModal
          open={!!editTerminal}
          terminal={editTerminal}
          onSave={async ({ name, settings }) => {
            try {
              await updateTerminal(editTerminal.id, { name, settings })
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
          onConfirm={async () => {
            await deleteTerminal(deleteTerminalTarget.id, { deleteDirectory })
            setDeleteTerminalTarget(null)
          }}
          onCancel={() => {
            setDeleteTerminalTarget(null)
          }}
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
        <RenameModal
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
          onConfirm={async () => {
            await deleteSession(deleteSessionTarget.session_id)
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

      {deleteBranchConfirm && (
        <ConfirmModal
          open={!!deleteBranchConfirm}
          title="Delete Branch"
          message={`Are you sure you want to delete the branch "${deleteBranchConfirm.branch}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            const result = await deleteBranch(
              deleteBranchConfirm.terminalId,
              deleteBranchConfirm.branch,
              deleteRemoteBranch,
            )
            const msg = result.deletedRemote
              ? `Deleted branch ${deleteBranchConfirm.branch} (local and remote)`
              : `Deleted branch ${deleteBranchConfirm.branch}`
            toast.success(msg)
            setDeleteBranchConfirm(null)
            closePalette()
          }}
          onCancel={() => setDeleteBranchConfirm(null)}
        >
          {deleteBranchConfirm.hasRemote && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={deleteRemoteBranch}
                onCheckedChange={(v) => setDeleteRemoteBranch(v === true)}
                className="w-5 h-5"
              />
              Also delete remote branch
            </label>
          )}
        </ConfirmModal>
      )}

      {mergeModal && (
        <MergePRModal
          open={!!mergeModal}
          pr={mergeModal}
          onClose={() => setMergeModal(null)}
          onSuccess={closePalette}
        />
      )}

      {closeModal && (
        <ConfirmModal
          open={!!closeModal}
          title="Close Pull Request"
          message={`Are you sure you want to close "${closeModal.prTitle}"? This will not delete the branch.`}
          confirmLabel="Close PR"
          variant="danger"
          onConfirm={async () => {
            const [owner, repo] = closeModal.repo.split('/')
            await closePR(owner, repo, closeModal.prNumber)
            toast.success(`Closed PR #${closeModal.prNumber}`)
            setCloseModal(null)
          }}
          onCancel={() => setCloseModal(null)}
        />
      )}

      {renamePRTarget && (
        <RenameModal
          open={!!renamePRTarget}
          title="Rename PR"
          placeholder="PR title"
          currentName={renamePRTarget.prTitle}
          onSave={async (newTitle) => {
            const [owner, repo] = renamePRTarget.repo.split('/')
            try {
              await renamePR(owner, repo, renamePRTarget.prNumber, newTitle)
              toast.success(`Renamed PR #${renamePRTarget.prNumber}`)
              setRenamePRTarget(null)
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : 'Failed to rename PR',
              )
            }
          }}
          onCancel={() => setRenamePRTarget(null)}
        />
      )}

      {renameBranchTarget && (
        <RenameModal
          open={!!renameBranchTarget}
          title="Rename Branch"
          placeholder="Branch name"
          currentName={renameBranchTarget.branch}
          onSave={async (newName) => {
            try {
              await renameBranch(
                renameBranchTarget.terminalId,
                renameBranchTarget.branch,
                newName,
              )
              toast.success(
                `Renamed branch ${renameBranchTarget.branch} to ${newName}`,
              )
              setRenameBranchTarget(null)
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : 'Failed to rename branch',
              )
            }
          }}
          onCancel={() => setRenameBranchTarget(null)}
        />
      )}

      {rerunAllModal && (
        <RerunChecksModal
          open={!!rerunAllModal}
          pr={rerunAllModal}
          onClose={() => setRerunAllModal(null)}
          onSuccess={closePalette}
        />
      )}

      {commitTerminalId != null && (
        <CommitDialog
          open={commitTerminalId != null}
          terminalId={commitTerminalId}
          onClose={() => setCommitTerminalId(null)}
        />
      )}

      {createBranchFrom && (
        <CreateBranchDialog
          open={!!createBranchFrom}
          fromBranch={createBranchFrom.branch}
          loading={createBranchLoading}
          onConfirm={async (name) => {
            setCreateBranchLoading(true)
            try {
              await createBranch(
                createBranchFrom.terminalId,
                name,
                createBranchFrom.branch,
              )
              toast.success(`Created and switched to ${name}`)
              setCreateBranchFrom(null)
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : 'Failed to create branch',
              )
            } finally {
              setCreateBranchLoading(false)
            }
          }}
          onCancel={() => setCreateBranchFrom(null)}
        />
      )}

      {filePickerTerminal && (
        <DirectoryBrowser
          open={!!filePickerTerminal}
          onOpenChange={(open) => {
            if (!open) setFilePickerTerminal(null)
          }}
          value={filePickerTerminal.cwd}
          onSelect={() => {}}
          mode="file"
          title="Select Files"
          onSelectPaths={(paths) => {
            const escaped = paths
              .map((p) => p.replace(/([ {2}\\'"()&|;$`!#{}[\]*?<>])/g, '\\$1'))
              .join(' ')
            window.dispatchEvent(
              new CustomEvent('terminal-paste', {
                detail: {
                  terminalId: filePickerTerminal.id,
                  text: escaped,
                },
              }),
            )
            setFilePickerTerminal(null)
          }}
          sshHost={filePickerTerminal.ssh_host ?? undefined}
        />
      )}
    </>
  )
}
