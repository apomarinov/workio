import type { BranchesResponse } from '@domains/git/schema'
import type { PRCheckStatus } from '@domains/github/schema'
import type { MoveTarget, SessionWithProject } from '@domains/sessions/schema'
import { DEFAULT_KEYMAP } from '@domains/settings/schema'
import type { Terminal } from '@domains/workspace/schema/terminals'
import {
  ArrowBigUp,
  ChevronUp,
  Command,
  Info,
  Option,
  TriangleAlert,
} from 'lucide-react'
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/sonner'
import { useGitHubContext } from '@/context/GitHubContext'
import { useProcessContext } from '@/context/ProcessContext'
import { useSessionContext } from '@/context/SessionContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useSettings } from '@/hooks/useSettings'
import { useSocket } from '@/hooks/useSocket'
import {
  checkoutBranch,
  closePR,
  createBranch,
  deleteBranch,
  editPR,
  fetchAll,
  getBranches,
  pullBranch,
  pushBranch,
  rebaseBranch,
  renameBranch,
} from '@/lib/api'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'

const CreatePRDialog = lazy(() =>
  import('@/components/dialogs/CreatePRDialog').then((m) => ({
    default: m.CreatePRDialog,
  })),
)

import { CleanupSessionsModal } from '@/components/CleanupSessionsModal'
import { ConfirmModal } from '@/components/ConfirmModal'
import { CreateBranchDialog } from '@/components/CreateBranchDialog'
import { DirectoryBrowser } from '@/components/DirectoryBrowser'
import { EditPRDialog } from '@/components/dialogs/EditPRDialog'
import { RenameModal } from '@/components/EditSessionModal'
import { MergePRModal } from '@/components/MergePRModal'
import { RerunChecksModal } from '@/components/RerunChecksModal'
import { CommandPaletteCore } from './CommandPaletteCore'
import {
  type AppActions,
  type AppData,
  createPaletteModes,
  getLastPathSegment,
} from './createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from './types'

const initialLevel: PaletteLevel = { mode: 'search', title: '' }

/** Get selectable command items from a custom-commands mode in render order */
function getCommandItems(mode: PaletteMode): PaletteItem[] {
  if (mode.groups) return mode.groups.flatMap((g) => g.items)
  return mode.items.filter((i) => i.id !== 'custom-cmd:create-new')
}

export function CommandPalette() {
  // Single stack state replaces modeStack + all mode-specific state
  const [open, setOpen] = useState(false)
  const [stack, setStack] = useState<PaletteLevel[]>([initialLevel])

  // Modal state (not navigation-related, stays separate)
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
  const [checkoutConfirm, setCheckoutConfirm] = useState<{
    name: string
    isRemote: boolean
  } | null>(null)
  const [checkoutPRConfirm, setCheckoutPRConfirm] = useState<{
    terminalId: number
    branch: string
  } | null>(null)

  // PR action modals
  const [mergeModal, setMergeModal] = useState<PRCheckStatus | null>(null)
  const [closeModal, setCloseModal] = useState<PRCheckStatus | null>(null)
  const [rerunAllModal, setRerunAllModal] = useState<PRCheckStatus | null>(null)
  const [filePickerTerminal, setFilePickerTerminal] = useState<Terminal | null>(
    null,
  )
  const [editPRTarget, setEditPRTarget] = useState<PRCheckStatus | null>(null)
  const [renameBranchTarget, setRenameBranchTarget] = useState<{
    terminalId: number
    branch: string
    hasRemote: boolean
  } | null>(null)
  const [renameRemoteBranch, setRenameRemoteBranch] = useState(false)
  const [createBranchFrom, setCreateBranchFrom] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  const [createBranchLoading, setCreateBranchLoading] = useState(false)
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false)
  const [createPRTarget, setCreatePRTarget] = useState<{
    terminal: Terminal
    branches: BranchesResponse
  } | null>(null)
  const [runConfirm, setRunConfirm] = useState<{
    terminalId: number
    shellId: number
    shellName: string
    processName: string
    command: string
    label: string
  } | null>(null)
  const [moveSessionTarget, setMoveSessionTarget] = useState<{
    session: SessionWithProject
    target: MoveTarget
  } | null>(null)

  const [, setSearchText] = useState('')

  const killShellMutation = trpc.workspace.shells.killShell.useMutation()
  const createShellMutation = trpc.workspace.shells.createShell.useMutation()
  const openInIdeMutation = trpc.workspace.system.openInIde.useMutation()
  const moveMutation = trpc.sessions.move.useMutation()
  const sessionUtils = trpc.useUtils().sessions
  const openInExplorerMutation =
    trpc.workspace.system.openInExplorer.useMutation()

  // Context data
  const { terminals, selectTerminal, createTerminal, deleteTerminal, refetch } =
    useWorkspaceContext()
  const { githubPRs, mergedPRs } = useGitHubContext()
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
  const toggleFavoriteMutation =
    trpc.sessions.sessionToggleFavorite.useMutation()

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
      window.dispatchEvent(new Event('dialog-closed'))
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

  // Listen for open-custom-commands event (dispatched from keyboard shortcut)
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      const terminal = terminals.find((t) => t.id === e.detail.terminalId)
      setStack([
        initialLevel,
        { mode: 'custom-commands', title: 'Custom Commands', terminal },
      ])
      setOpen(true)
    }
    window.addEventListener('open-custom-commands', handler as EventListener)
    return () =>
      window.removeEventListener(
        'open-custom-commands',
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
            toastError(err, 'Failed to fetch branches')
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

  // Listen for open-branch-actions event (opens branch actions for current branch)
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      const { terminalId } = e.detail
      const terminal = terminals.find((t) => t.id === terminalId)
      if (!terminal?.git_branch) return
      const pr = branchToPR.get(terminal.git_branch) ?? undefined
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
        {
          mode: 'branch-actions',
          title: terminal.git_branch,
          terminal,
          pr,
          branchesLoading: true,
          branch: {
            name: terminal.git_branch,
            isRemote: false,
            isCurrent: true,
          },
        },
      ])
      setOpen(true)
      getBranches(terminalId)
        .then((data) => {
          setStack((prev) => {
            const current = prev[prev.length - 1]
            if (current.mode !== 'branch-actions') return prev
            const branchesLevel = prev[prev.length - 2]
            return [
              ...prev.slice(0, -2),
              branchesLevel.mode === 'branches'
                ? { ...branchesLevel, branches: data, branchesLoading: false }
                : branchesLevel,
              { ...current, branches: data, branchesLoading: false },
            ]
          })
        })
        .catch(() => {
          setStack((prev) => {
            const current = prev[prev.length - 1]
            if (current.mode !== 'branch-actions') return prev
            const branchesLevel = prev[prev.length - 2]
            return [
              ...prev.slice(0, -2),
              branchesLevel.mode === 'branches'
                ? { ...branchesLevel, branchesLoading: false }
                : branchesLevel,
              { ...current, branchesLoading: false },
            ]
          })
        })
    }
    window.addEventListener('open-branch-actions', handler as EventListener)
    return () =>
      window.removeEventListener(
        'open-branch-actions',
        handler as EventListener,
      )
  }, [terminals, branchToPR])

  // Reset search text when palette closes or mode changes (input remounts via key)
  useEffect(() => {
    void open
    void currentModeId
    setSearchText('')
  }, [open, currentModeId])

  // Broadcast palette state for module-level tracking in useKeyboardShortcuts
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('palette-state', {
        detail: { open, mode: currentModeId },
      }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('palette-state', {
          detail: { open: false, mode: '' },
        }),
      )
    }
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
      processes,
      shellPorts,
      shellTemplates: settings?.shell_templates ?? [],
      starredBranches: settings?.starred_branches ?? {},
      customActions: settings?.custom_terminal_actions ?? [],
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
      processes,
      shellPorts,
      settings?.shell_templates,
      settings?.starred_branches,
      settings?.custom_terminal_actions,
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

  const doRunInShell = (
    terminalId: number,
    shellId: number,
    command: string,
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
    emit('run-in-shell', { shellId, command, terminalId })
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('terminal-focus', { detail: { terminalId } }),
      )
    }, 350)
  }

  const requestRunInShell = (
    terminalId: number,
    command: string,
    label: string,
    explicitShellId?: number,
  ) => {
    const terminal = terminals.find((t) => t.id === terminalId)
    if (!terminal) return

    // Resolve target shell: explicit → active from localStorage → main → first
    let targetShell = explicitShellId
      ? terminal.shells.find((s) => s.id === explicitShellId)
      : undefined
    if (!targetShell) {
      const stored: Record<number, number> = (() => {
        try {
          const saved = localStorage.getItem('active-shells')
          return saved ? JSON.parse(saved) : {}
        } catch {
          return {}
        }
      })()
      const activeShellId = stored[terminalId]
      if (activeShellId) {
        targetShell = terminal.shells.find((s) => s.id === activeShellId)
      }
    }
    if (!targetShell) {
      targetShell =
        terminal.shells.find((s) => s.name === 'main') ?? terminal.shells[0]
    }
    if (!targetShell) return

    // Check if target shell has a running process
    const shellProcess = processes.find(
      (p) => p.shellId === targetShell.id && p.pid > 0,
    )

    if (shellProcess) {
      setRunConfirm({
        terminalId,
        shellId: targetShell.id,
        shellName: targetShell.name,
        processName: shellProcess.command || shellProcess.name,
        command,
        label,
      })
    } else {
      doRunInShell(terminalId, targetShell.id, command)
    }
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
          await openInIdeMutation.mutateAsync({
            path: terminal.cwd,
            ide: preferredIDE,
            ssh_host: terminal.ssh_host ?? undefined,
          })
        } catch {
          // CLI not available — fall back to URL scheme
          const scheme = preferredIDE === 'vscode' ? 'vscode' : 'cursor'
          const uri = terminal.ssh_host
            ? `${scheme}://vscode-remote/ssh-remote+${terminal.ssh_host}${terminal.cwd}`
            : `${scheme}://file/${terminal.cwd}`
          window.open(uri, '_blank')
        }
      },
      openInExplorer: async (terminal) => {
        try {
          await openInExplorerMutation.mutateAsync({ path: terminal.cwd })
        } catch (err) {
          toastError(err, 'Failed to open file explorer')
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
          toastError(err, 'Failed to add workspace')
        }
      },
      openEditModal: (terminal) => {
        closePalette()
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent('open-terminal-modal', {
                detail: { terminalId: terminal.id },
              }),
            ),
          150,
        )
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

        // Build command client-side
        const cmd =
          (terminal.settings as { defaultClaudeCommand?: string } | null)
            ?.defaultClaudeCommand || 'claude'
        const fullCommand = `${cmd} --resume ${session.session_id}`
        const label = session.name || session.session_id

        // Resolve target shell: prefer session's shell_id if it still exists
        const explicitShellId =
          session.shell_id &&
          terminal.shells.find((s) => s.id === session.shell_id)
            ? session.shell_id
            : undefined

        requestRunInShell(
          session.terminal_id,
          fullCommand,
          label,
          explicitShellId,
        )
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
        sessionUtils.moveTargets
          .fetch({ id: sessionId })
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
          await toggleFavoriteMutation.mutateAsync({ id: sessionId })
          refetchSessions()
        } catch (err) {
          toastError(err, 'Failed to toggle favorite')
        }
      },

      // Star actions
      toggleStarBranch: async (repo, branchName) => {
        try {
          const current = settings?.starred_branches ?? {}
          const branches = current[repo] ?? []
          const starred = { ...current }
          if (branches.includes(branchName)) {
            starred[repo] = branches.filter((b) => b !== branchName)
            if (starred[repo].length === 0) delete starred[repo]
          } else {
            starred[repo] = [...branches, branchName]
          }
          await updateSettings({ starred_branches: starred })
        } catch (err) {
          toastError(err, 'Failed to toggle star')
        }
      },

      // Branch actions
      fetchAll: async (terminalId) => {
        const terminal = terminals.find((t) => t.id === terminalId)
        if (!terminal) return
        api.updateLevel((l) => ({
          ...l,
          loadingStates: { ...l.loadingStates, fetching: true },
        }))
        try {
          await fetchAll(terminalId)
          toast.success('Fetched all remotes')
          // Refetch branches to reflect any new remote branches
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
            .catch(() => toast.error('Failed to load branches'))
        } catch (err) {
          toastError(err, 'Failed to fetch')
        } finally {
          api.updateLevel((l) => ({
            ...l,
            loadingStates: { ...l.loadingStates, fetching: undefined },
          }))
        }
      },
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
            toastError(err, 'Failed to fetch branches')
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
      requestCheckoutBranch: (name, isRemote) => {
        setCheckoutConfirm({ name, isRemote })
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
          toastError(err, 'Failed to checkout branch')
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
          toastError(err, 'Failed to pull branch')
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
        const toastId = toast.loading(
          force ? `Force pushing ${name}...` : `Pushing ${name}...`,
        )
        try {
          await pushBranch(terminal.id, name, force)
          toast.success(force ? `Force pushed ${name}` : `Pushed ${name}`, {
            id: toastId,
          })
        } catch (err) {
          toast.dismiss(toastId)
          toastError(err, 'Failed to push branch')
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
          toastError(err, 'Failed to rebase branch')
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
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent('open-commit-dialog', {
                detail: { terminalId },
              }),
            ),
          150,
        )
      },
      requestCreateBranch: (terminalId, branch) => {
        closePalette()
        setTimeout(() => setCreateBranchFrom({ terminalId, branch }), 150)
      },
      requestRenameBranch: (terminalId, branch, hasRemote) => {
        closePalette()
        setRenameRemoteBranch(false)
        setTimeout(
          () => setRenameBranchTarget({ terminalId, branch, hasRemote }),
          150,
        )
      },

      // PR actions
      openCreatePRModal: async (terminal) => {
        closePalette()
        try {
          const data = await getBranches(terminal.id)
          setCreatePRTarget({ terminal, branches: data })
        } catch (err) {
          toastError(err, 'Failed to fetch branches')
        }
      },
      openDiffViewer: (pr, terminalId) => {
        closePalette()
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent('open-commit-dialog', {
                detail: { terminalId, pr },
              }),
            ),
          150,
        )
      },
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
      requestCheckoutPRBranch: (terminalId, branch) => {
        setCheckoutPRConfirm({ terminalId, branch })
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
          selectTerminal(terminalId)
          clearSession()
          closePalette()
          window.dispatchEvent(
            new CustomEvent('reveal-terminal', { detail: { id: terminalId } }),
          )
        } catch (err) {
          toastError(err, 'Failed to checkout branch')
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
          toastError(err, 'Failed to hide PR')
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

      // Terminal paste
      sendToTerminal: (terminalId, text) => {
        window.dispatchEvent(
          new CustomEvent('terminal-paste', {
            detail: { terminalId, text },
          }),
        )
      },

      // Run command in shell (with process detection)
      runCommandInShell: (terminalId, command, label) => {
        closePalette()
        requestRunInShell(terminalId, command, label)
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
  const rawModes = useMemo(
    () => createPaletteModes(appData, currentLevel, appActions, api),
    [appData, currentLevel, appActions, api],
  )

  // Resolve goToTab binding for modifier badge display
  const goToTabBinding =
    settings?.keymap?.goToTab === null
      ? null
      : (settings?.keymap?.goToTab ?? DEFAULT_KEYMAP.goToTab)

  // Post-process custom-commands mode to add modifier+digit badges
  const modes = useMemo(() => {
    const ccMode = rawModes['custom-commands']
    if (!goToTabBinding || !ccMode) return rawModes
    const commandItems = getCommandItems(ccMode)
    if (commandItems.length === 0) return rawModes
    const modIcons = (
      <span className="inline-flex items-center">
        {goToTabBinding.ctrlKey && <ChevronUp className="w-3 h-3" />}
        {goToTabBinding.altKey && <Option className="w-3 h-3" />}
        {goToTabBinding.shiftKey && <ArrowBigUp className="w-3 h-3" />}
        {goToTabBinding.metaKey && <Command className="w-3 h-3" />}
      </span>
    )
    // Build a map of item id -> digit badge (1-9)
    const badgeMap = new Map<string, number>()
    for (let i = 0; i < Math.min(commandItems.length, 9); i++) {
      badgeMap.set(commandItems[i].id, i + 1)
    }
    const addBadge = (item: PaletteItem): PaletteItem => {
      const digit = badgeMap.get(item.id)
      if (digit == null) return item
      return {
        ...item,
        rightSlot: (
          <span className="flex items-center gap-0.5 text-[11px] text-zinc-500">
            {modIcons}
            <span className="w-[15px] text-center">{digit}</span>
          </span>
        ),
      }
    }
    return {
      ...rawModes,
      'custom-commands': {
        ...ccMode,
        items: ccMode.items.map((item) =>
          badgeMap.has(item.id) ? addBadge(item) : item,
        ),
        groups: ccMode.groups?.map((g) => ({
          ...g,
          items: g.items.map(addBadge),
        })),
      },
    }
  }, [rawModes, goToTabBinding])

  // Listen for digit selection when in custom-commands mode
  const modesRef = useRef(modes)
  modesRef.current = modes
  useEffect(() => {
    if (!open || currentModeId !== 'custom-commands') return
    const handler = (e: Event) => {
      const index = (e as CustomEvent).detail.index as number
      const mode = modesRef.current['custom-commands']
      if (!mode) return
      const items = getCommandItems(mode)
      const target = items[index - 1]
      if (target) target.onSelect()
    }
    window.addEventListener('palette-select-index', handler)
    return () => window.removeEventListener('palette-select-index', handler)
  }, [open, currentModeId])

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
              Also delete directory
            </label>
          )}
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

      {runConfirm && (
        <ConfirmModal
          open={!!runConfirm}
          title="Process Running"
          message={`"${runConfirm.processName}" is running in shell "${runConfirm.shellName}". Kill it to run "${runConfirm.label}"?`}
          confirmLabel="Kill & Run"
          variant="danger"
          onConfirm={async () => {
            const { terminalId, shellId, command } = runConfirm
            try {
              await killShellMutation.mutateAsync({ id: shellId })
            } catch (err) {
              toastError(err, 'Failed to kill process')
              return
            }
            setRunConfirm(null)
            doRunInShell(terminalId, shellId, command)
          }}
          secondaryAction={[
            {
              label: 'Run Anyway',
              onAction: () => {
                const { terminalId, shellId, command } = runConfirm
                setRunConfirm(null)
                doRunInShell(terminalId, shellId, command)
              },
            },
            {
              label: 'Run in New Shell',
              onAction: async () => {
                const { terminalId, command } = runConfirm
                try {
                  const shell = await createShellMutation.mutateAsync({
                    terminalId,
                  })
                  await refetch()
                  setRunConfirm(null)
                  doRunInShell(terminalId, shell.id, command)
                } catch (err) {
                  toastError(err, 'Failed to create shell')
                }
              },
            },
          ]}
          onCancel={() => setRunConfirm(null)}
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
              const { snapshotDir } = await moveMutation.mutateAsync({
                id: s.session_id,
                targetProjectPath: target.projectPath,
                targetTerminalId: target.terminalId,
              })
              toast.success('Session moved successfully', {
                description: snapshotDir
                  ? `Snapshot: ${snapshotDir}`
                  : undefined,
              })
            } catch (err) {
              toastError(err, 'Failed to move session')
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

      {checkoutConfirm && (
        <ConfirmModal
          open={!!checkoutConfirm}
          title="Uncommitted Changes"
          message={`You have uncommitted changes. Are you sure you want to checkout "${checkoutConfirm.name}"? Your changes may be lost.`}
          confirmLabel="Checkout"
          variant="danger"
          onConfirm={() => {
            const { name, isRemote } = checkoutConfirm
            setCheckoutConfirm(null)
            appActions.checkoutBranch(name, isRemote)
          }}
          onCancel={() => setCheckoutConfirm(null)}
        />
      )}

      {checkoutPRConfirm && (
        <ConfirmModal
          open={!!checkoutPRConfirm}
          title="Uncommitted Changes"
          message={`You have uncommitted changes. Are you sure you want to checkout "${checkoutPRConfirm.branch}"? Your changes may be lost.`}
          confirmLabel="Checkout"
          variant="danger"
          onConfirm={() => {
            const { terminalId, branch } = checkoutPRConfirm
            setCheckoutPRConfirm(null)
            appActions.checkoutPRBranch(terminalId, branch)
          }}
          onCancel={() => setCheckoutPRConfirm(null)}
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

      {editPRTarget && (
        <EditPRDialog
          open={!!editPRTarget}
          currentTitle={editPRTarget.prTitle}
          currentBody={editPRTarget.prBody}
          currentDraft={editPRTarget.isDraft}
          onSave={async (newTitle, newBody, newDraft) => {
            const [owner, repo] = editPRTarget.repo.split('/')
            await editPR(
              owner,
              repo,
              editPRTarget.prNumber,
              newTitle,
              newBody,
              newDraft,
            )
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
            const result = await renameBranch(
              renameBranchTarget.terminalId,
              renameBranchTarget.branch,
              newName,
              renameRemoteBranch,
            )
            const msg = result.renamedRemote
              ? `Renamed branch ${renameBranchTarget.branch} to ${newName} (local and remote)`
              : `Renamed branch ${renameBranchTarget.branch} to ${newName}`
            toast.success(msg)
            setRenameBranchTarget(null)
          }}
          onCancel={() => setRenameBranchTarget(null)}
        >
          {renameBranchTarget.hasRemote && (
            <label className="flex items-center gap-2 text-sm cursor-pointer mt-3">
              <Checkbox
                checked={renameRemoteBranch}
                onCheckedChange={(v) => setRenameRemoteBranch(v === true)}
                className="w-5 h-5"
              />
              Also rename remote branch
            </label>
          )}
        </RenameModal>
      )}

      {rerunAllModal && (
        <RerunChecksModal
          open={!!rerunAllModal}
          pr={rerunAllModal}
          onClose={() => setRerunAllModal(null)}
          onSuccess={closePalette}
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
              toastError(err, 'Failed to create branch')
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
          onSelectPaths={(paths) => {
            const escaped = paths
              .map((p) => p.replace(/([ \\'"()&|;$`!#{}[\]*?<>])/g, '\\$1'))
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
            window.dispatchEvent(new Event('dialog-closed'))
          }}
          sshHost={filePickerTerminal.ssh_host ?? undefined}
        />
      )}

      {createPRTarget && (
        <CreatePRDialog
          open={!!createPRTarget}
          terminal={createPRTarget.terminal}
          branches={createPRTarget.branches}
          onClose={() => setCreatePRTarget(null)}
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
