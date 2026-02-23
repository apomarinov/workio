import { Info, TriangleAlert } from 'lucide-react'
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
  editPR,
  getBranches,
  getMoveTargets,
  killShell,
  moveSession,
  openInExplorer,
  openInIDE,
  pullBranch,
  pushBranch,
  rebaseBranch,
  renameBranch,
  searchSessionMessages,
  toggleFavoriteSession,
} from '@/lib/api'
import type { PRCheckStatus } from '../../../shared/types'
import type {
  MoveTarget,
  SessionSearchMatch,
  SessionWithProject,
  Terminal,
} from '../../types'

const CommitDialog = lazy(() =>
  import('../CommitDialog').then((m) => ({ default: m.CommitDialog })),
)

import { CleanupSessionsModal } from '../CleanupSessionsModal'
import { ConfirmModal } from '../ConfirmModal'
import { CreateBranchDialog } from '../CreateBranchDialog'
import { DirectoryBrowser } from '../DirectoryBrowser'
import { EditPRDialog } from '../dialogs/EditPRDialog'
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
  const [editPRTarget, setEditPRTarget] = useState<PRCheckStatus | null>(null)
  const [renameBranchTarget, setRenameBranchTarget] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  const [createBranchFrom, setCreateBranchFrom] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  const [createBranchLoading, setCreateBranchLoading] = useState(false)
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false)
  const [resumeConfirm, setResumeConfirm] = useState<{
    session: SessionWithProject
    shellId: number
    shellName: string
    processName: string
  } | null>(null)
  const [moveSessionTarget, setMoveSessionTarget] = useState<{
    session: SessionWithProject
    target: MoveTarget
  } | null>(null)

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
  const { gitDirtyStatus, processes, shellPorts } = useProcessContext()
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

  // Listen for open-shell-templates event (dispatched from keyboard shortcut)
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      const terminal = terminals.find((t) => t.id === e.detail.terminalId)
      setStack([
        initialLevel,
        { mode: 'shell-templates', title: 'Shell Templates', terminal },
      ])
      setOpen(true)
    }
    window.addEventListener('open-shell-templates', handler as EventListener)
    return () =>
      window.removeEventListener(
        'open-shell-templates',
        handler as EventListener,
      )
  }, [terminals])

  // Listen for open-file-picker event (dispatched from shell tab context menu)
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminal: Terminal }>) => {
      setFilePickerTerminal(e.detail.terminal)
    }
    window.addEventListener('open-file-picker', handler as EventListener)
    return () =>
      window.removeEventListener('open-file-picker', handler as EventListener)
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
      processes,
      shellPorts,
      shellTemplates: settings?.shell_templates ?? [],
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
      processes,
      shellPorts,
      settings?.shell_templates,
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

  const doResumeSession = (
    terminalId: number,
    sessionId: string,
    shellId: number,
  ) => {
    selectTerminal(terminalId)
    clearSession()
    window.dispatchEvent(
      new CustomEvent('reveal-terminal', { detail: { id: terminalId } }),
    )
    window.dispatchEvent(
      new CustomEvent('shell-select', {
        detail: { terminalId, shellId },
      }),
    )
    emit('resume-session', { terminalId, sessionId, shellId })
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('terminal-focus', { detail: { terminalId } }),
      )
    }, 350)
  }

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
        if (!session.terminal_id) return

        const terminal = terminals.find((t) => t.id === session.terminal_id)
        if (!terminal) return

        // Resolve target shell: prefer session's shell_id if it still exists, else main shell
        const targetShell =
          (session.shell_id &&
            terminal.shells.find((s) => s.id === session.shell_id)) ||
          terminal.shells.find((s) => s.name === 'main') ||
          terminal.shells[0]
        if (!targetShell) return

        // Check if target shell has a running process
        const shellProcess = processes.find(
          (p) => p.shellId === targetShell.id && p.pid > 0,
        )

        if (shellProcess) {
          setResumeConfirm({
            session,
            shellId: targetShell.id,
            shellName: targetShell.name,
            processName: shellProcess.name || shellProcess.command,
          })
        } else {
          doResumeSession(
            session.terminal_id,
            session.session_id,
            targetShell.id,
          )
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
      loadMoveTargets: (sessionId) => {
        getMoveTargets(sessionId)
          .then((data) => {
            setStack((prev) => {
              const current = prev[prev.length - 1]
              if (current.mode !== 'move-to-project') return prev
              return [
                ...prev.slice(0, -1),
                {
                  ...current,
                  moveTargets: data.targets,
                  moveTargetsLoading: false,
                },
              ]
            })
          })
          .catch((err) => {
            toast.error(
              err instanceof Error
                ? err.message
                : 'Failed to fetch move targets',
            )
            setStack((prev) => {
              const current = prev[prev.length - 1]
              if (current.mode !== 'move-to-project') return prev
              return [
                ...prev.slice(0, -1),
                { ...current, moveTargetsLoading: false },
              ]
            })
          })
      },
      openMoveSessionModal: (session, target) => {
        closePalette()
        setTimeout(() => setMoveSessionTarget({ session, target }), 150)
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
      openEditPRModal: (pr) => {
        closePalette()
        setTimeout(() => setEditPRTarget(pr), 150)
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
      selectShell: (terminalId, shellId) => {
        selectTerminal(terminalId)
        clearSession()
        closePalette()
        window.dispatchEvent(
          new CustomEvent('reveal-terminal', { detail: { id: terminalId } }),
        )
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId, shellId },
          }),
        )
      },
      runTemplate: (template) => {
        const terminalId = currentLevel.terminal?.id ?? terminals[0]?.id
        if (terminalId == null) return
        closePalette()
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('shell-template-request', {
              detail: { terminalId, template },
            }),
          )
        }, 150)
      },

      // Cleanup actions
      openCleanupModal: () => {
        closePalette()
        setTimeout(() => setCleanupModalOpen(true), 150)
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
      terminals,
      processes,
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
            await updateTerminal(editTerminal.id, { name, settings })
            setEditTerminal(null)
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
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={deleteDirectory}
              onCheckedChange={(v) => setDeleteDirectory(v === true)}
              className="w-5 h-5"
            />
            Also delete directory
          </label>
        </ConfirmModal>
      )}

      {renameSession && (
        <RenameModal
          open={!!renameSession}
          currentName={renameSession.name ?? ''}
          onSave={async (name) => {
            await updateSession(renameSession.session_id, { name })
            setRenameSession(null)
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

      {resumeConfirm && (
        <ConfirmModal
          open={!!resumeConfirm}
          title="Resume Session"
          message={`"${resumeConfirm.processName}" is running in shell "${resumeConfirm.shellName}". Kill it to resume "${resumeConfirm.session.name || resumeConfirm.session.session_id}"?`}
          confirmLabel="Kill & Resume"
          variant="danger"
          onConfirm={async () => {
            const { session, shellId } = resumeConfirm
            await killShell(shellId)
            setResumeConfirm(null)
            doResumeSession(session.terminal_id!, session.session_id, shellId)
          }}
          onCancel={() => setResumeConfirm(null)}
        />
      )}

      {moveSessionTarget && (
        <ConfirmModal
          open={!!moveSessionTarget}
          title="Move Session"
          message={`Move this session to a different project?`}
          confirmLabel="Move"
          onConfirm={async () => {
            const { session: s, target } = moveSessionTarget
            try {
              const { snapshotDir } = await moveSession(
                s.session_id,
                target.projectPath,
                target.terminalId,
              )
              toast.success('Session moved successfully', {
                description: snapshotDir
                  ? `Snapshot: ${snapshotDir}`
                  : undefined,
              })
            } catch (err) {
              const snapshotDir = (err as Error & { snapshotDir?: string })
                .snapshotDir
              toast.error(
                err instanceof Error ? err.message : 'Failed to move session',
                {
                  description: snapshotDir
                    ? `Snapshot: ${snapshotDir}`
                    : undefined,
                },
              )
            }
            refetchSessions()
            setMoveSessionTarget(null)
          }}
          onCancel={() => setMoveSessionTarget(null)}
        >
          <div className="space-y-2 text-sm text-zinc-400">
            <div>
              <span className="text-zinc-500">Session:</span>{' '}
              {moveSessionTarget.session.name ??
                moveSessionTarget.session.session_id}
            </div>
            <div>
              <span className="text-zinc-500">From:</span>{' '}
              {moveSessionTarget.session.project_path}
            </div>
            <div>
              <span className="text-zinc-500">To:</span>{' '}
              {moveSessionTarget.target.projectPath}
            </div>
            {moveSessionTarget.target.sshHost && (
              <div className="mt-2 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                Operations will run on SSH host:{' '}
                <span className="font-mono text-zinc-200">
                  {moveSessionTarget.target.sshHost}
                </span>
              </div>
            )}
            {!moveSessionTarget.target.claudeDirExists && (
              <div className="text-xs text-yellow-500">
                Target Claude project directory will be created.
              </div>
            )}
            <div className="mt-2 flex items-center gap-1.5 rounded bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-400">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              Make sure you have exited this session in Claude before moving.
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 text-xs text-blue-400">
              <Info className="h-3.5 w-3.5 shrink-0" />A snapshot of all
              affected files will be taken before moving. If anything fails,
              everything will be restored automatically.
            </div>
          </div>
        </ConfirmModal>
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

      {editPRTarget && (
        <EditPRDialog
          open={!!editPRTarget}
          currentTitle={editPRTarget.prTitle}
          currentBody={editPRTarget.prBody}
          onSave={async (newTitle, newBody) => {
            const [owner, repo] = editPRTarget.repo.split('/')
            await editPR(owner, repo, editPRTarget.prNumber, newTitle, newBody)
            toast.success(`Updated PR #${editPRTarget.prNumber}`)
            setEditPRTarget(null)
          }}
          onCancel={() => setEditPRTarget(null)}
        />
      )}

      {renameBranchTarget && (
        <RenameModal
          open={!!renameBranchTarget}
          title="Rename Branch"
          placeholder="Branch name"
          currentName={renameBranchTarget.branch}
          onSave={async (newName) => {
            await renameBranch(
              renameBranchTarget.terminalId,
              renameBranchTarget.branch,
              newName,
            )
            toast.success(
              `Renamed branch ${renameBranchTarget.branch} to ${newName}`,
            )
            setRenameBranchTarget(null)
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

      <CleanupSessionsModal
        open={cleanupModalOpen}
        onClose={() => setCleanupModalOpen(false)}
        onSuccess={() => refetchSessions()}
      />
    </>
  )
}
