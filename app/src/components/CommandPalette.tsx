import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Eye,
  FolderOpen,
  GitBranch,
  GitFork,
  GitMerge,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
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
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import type { SessionWithProject, Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { EditSessionModal } from './EditSessionModal'
import { EditTerminalModal } from './EditTerminalModal'
import { PRTabButton } from './PRStatusContent'

type Mode = 'search' | 'actions' | 'branches' | 'branch-actions'

type ActionTarget =
  | { type: 'terminal'; terminal: Terminal; pr: PRCheckStatus | null }
  | { type: 'session'; session: SessionWithProject }

type ItemInfo =
  | {
      type: 'terminal'
      terminal: Terminal
      pr: PRCheckStatus | null
      actionHint: string | null
    }
  | { type: 'pr'; pr: PRCheckStatus; actionHint: string }
  | { type: 'session'; session: SessionWithProject; actionHint: string | null }

function getLastPathSegment(cwd: string) {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

const sessionStatusColor: Record<string, string> = {
  started: 'text-green-500',
  active: 'text-[#D97757]',
  done: 'text-gray-500',
  ended: 'text-gray-500',
  permission_needed: 'text-[#D97757]',
  idle: 'text-gray-400',
}

function SessionIcon({ status }: { status: string }) {
  if (status === 'done')
    return <Check className="h-4 w-4 shrink-0 text-green-500/70" />
  if (status === 'active' || status === 'permission_needed')
    return (
      <>
        {(status === 'active' || status === 'permission_needed') && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 300 150"
            className="h-4 w-4 shrink-0"
          >
            <path
              fill="none"
              stroke="#D97757"
              strokeWidth="40"
              strokeLinecap="round"
              strokeDasharray="300 385"
              strokeDashoffset="0"
              d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"
            >
              <animate
                attributeName="stroke-dashoffset"
                calcMode="spline"
                dur="2s"
                values="685;-685"
                keySplines="0 0 1 1"
                repeatCount="indefinite"
              />
            </path>
          </svg>
        )}
        {status === 'permission_needed' && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500 animate-pulse" />
        )}
      </>
    )
  return (
    <Bot
      className={cn(
        'h-4 w-4 shrink-0',
        sessionStatusColor[status] ?? 'text-gray-400',
      )}
    />
  )
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('search')
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

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

  // Pin state (shared localStorage keys with sidebar)
  const [pinnedTerminalSessions, setPinnedTerminalSessions] = useLocalStorage<
    number[]
  >('sidebar-pinned-terminal-sessions', [])
  const [pinnedSessions, setPinnedSessions] = useLocalStorage<string[]>(
    'sidebar-pinned-sessions',
    [],
  )

  // Modal state for actions that need modals after palette closes
  const [editTerminal, setEditTerminal] = useState<Terminal | null>(null)
  const [deleteTerminalTarget, setDeleteTerminalTarget] =
    useState<Terminal | null>(null)
  const [deleteDirectory, setDeleteDirectory] = useState(false)
  const [renameSession, setRenameSession] = useState<SessionWithProject | null>(
    null,
  )
  const [deleteSessionTarget, setDeleteSessionTarget] =
    useState<SessionWithProject | null>(null)

  // Branches state
  const [branches, setBranches] = useState<{
    local: BranchInfo[]
    remote: BranchInfo[]
  } | null>(null)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [checkingOutBranch, setCheckingOutBranch] = useState<string | null>(
    null,
  )
  const [pullingBranch, setPullingBranch] = useState<string | null>(null)
  const [pushingBranch, setPushingBranch] = useState<{
    branch: string
    force: boolean
  } | null>(null)
  const [forcePushConfirm, setForcePushConfirm] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<{
    name: string
    isRemote: boolean
    isCurrent: boolean
  } | null>(null)

  const { gitDirtyStatus } = useProcessContext()

  const openPRs = githubPRs.filter((pr) => pr.state === 'OPEN')

  // Match TerminalItem logic: prefer OPEN, fall back to MERGED
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

  // Build item map keyed by simple IDs
  const itemMap = useMemo(() => {
    const map = new Map<string, ItemInfo>()

    for (const t of terminals) {
      const pr = t.git_branch ? (branchToPR.get(t.git_branch) ?? null) : null
      map.set(`t:${t.id}`, {
        type: 'terminal',
        terminal: t,
        pr,
        actionHint: t.ssh_host ? null : 'For actions',
      })
    }

    for (const pr of openPRs) {
      map.set(`pr:${pr.prNumber}:${pr.repo}`, {
        type: 'pr',
        pr,
        actionHint: 'Open PR in new tab',
      })
    }

    // Note: merged PRs are not added to itemMap since they're simpler type

    for (const s of sessions) {
      map.set(`s:${s.session_id}`, {
        type: 'session',
        session: s,
        actionHint: 'For actions',
      })
    }

    return map
  }, [terminals, openPRs, sessions, branchToPR])

  // Resolve the currently highlighted item
  const highlightedItem = highlightedId
    ? (itemMap.get(highlightedId) ?? null)
    : null

  useEffect(() => {
    const handler = () => {
      setMode('search')
      setOpen(true)
    }
    window.addEventListener('open-palette', handler)
    return () => window.removeEventListener('open-palette', handler)
  }, [])

  // Listen for item-actions event to open directly to actions mode
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number | null; sessionId: string | null }>,
    ) => {
      const { terminalId, sessionId } = e.detail

      // If viewing a session, show session actions
      if (sessionId) {
        const session = sessions.find((s) => s.session_id === sessionId)
        if (session) {
          setActionTarget({ type: 'session', session })
          setMode('actions')
          setOpen(true)
          return
        }
      }

      // Otherwise show terminal actions
      if (terminalId) {
        const terminal = terminals.find((t) => t.id === terminalId)
        if (terminal && !terminal.ssh_host) {
          const pr = terminal.git_branch
            ? (branchToPR.get(terminal.git_branch) ?? null)
            : null
          setActionTarget({ type: 'terminal', terminal, pr })
          setMode('actions')
          setOpen(true)
        }
      }
    }
    window.addEventListener('open-item-actions', handler as EventListener)
    return () =>
      window.removeEventListener('open-item-actions', handler as EventListener)
  }, [terminals, sessions, branchToPR])

  // Listen for open-terminal-branches event to open directly to branches mode
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      const { terminalId } = e.detail
      const terminal = terminals.find((t) => t.id === terminalId)
      if (terminal?.git_repo) {
        const pr = terminal.git_branch
          ? (branchToPR.get(terminal.git_branch) ?? null)
          : null
        setActionTarget({ type: 'terminal', terminal, pr })
        setMode('branches')
        setBranches(null)
        setBranchesLoading(true)
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

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
    if (!value) {
      setTimeout(() => {
        setActionTarget(null)
        setHighlightedId(null)
        setBranches(null)
        setBranchesLoading(false)
        setCheckingOutBranch(null)
        setPullingBranch(null)
        setPushingBranch(null)
        setSelectedBranch(null)
        setMode('search')
      }, 300)
    }
  }, [])

  const closePalette = useCallback(() => {
    handleOpenChange(false)
  }, [handleOpenChange])

  const handleSelectTerminal = useCallback(
    (id: number) => {
      selectTerminal(id)
      clearSession()
      closePalette()
      window.dispatchEvent(
        new CustomEvent('reveal-terminal', { detail: { id } }),
      )
    },
    [selectTerminal, clearSession, closePalette],
  )

  const handleSelectPR = useCallback(
    (pr: { branch: string; repo: string }) => {
      closePalette()
      window.dispatchEvent(
        new CustomEvent('reveal-pr', {
          detail: { branch: pr.branch, repo: pr.repo },
        }),
      )
    },
    [closePalette],
  )

  const handleOpenPR = useCallback(
    (pr: PRCheckStatus) => {
      window.open(pr.prUrl, '_blank')
      closePalette()
    },
    [closePalette],
  )

  const handleOpenInCursor = useCallback(
    (terminal: Terminal) => {
      window.open(`cursor://file/${terminal.cwd}`, '_blank')
      closePalette()
    },
    [closePalette],
  )

  // onValueChange now receives our simple ID directly
  const handleValueChange = useCallback((id: string) => {
    setHighlightedId(id)
  }, [])

  const handleEscapeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      closePalette()
    },
    [closePalette],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && mode === 'actions') {
        e.preventDefault()
        // Restore highlight to the item we came from
        const restoreId =
          actionTarget?.type === 'terminal'
            ? `t:${actionTarget.terminal.id}`
            : actionTarget?.type === 'session'
              ? `s:${actionTarget.session.session_id}`
              : null
        setMode('search')
        setActionTarget(null)
        setHighlightedId(restoreId)
        return
      }

      if (e.key === 'ArrowLeft' && mode === 'branches') {
        e.preventDefault()
        setMode('actions')
        setBranches(null)
        setHighlightedId('action:branches')
        return
      }

      if (e.key === 'ArrowLeft' && mode === 'branch-actions') {
        e.preventDefault()
        // Restore highlight to the branch we came from
        const prefix = selectedBranch?.isRemote ? 'remote' : 'local'
        const restoreId = selectedBranch
          ? `branch:${prefix}:${selectedBranch.name}`
          : null
        setMode('branches')
        setSelectedBranch(null)
        setHighlightedId(restoreId)
        return
      }

      // ArrowRight to open a new mode (only when selection would open a new list)
      if (e.key === 'ArrowRight') {
        // In search mode: open actions for terminal/session (not for PRs - they just open a link)
        if (mode === 'search' && highlightedItem) {
          if (
            highlightedItem.type === 'terminal' &&
            !highlightedItem.terminal.ssh_host
          ) {
            e.preventDefault()
            setActionTarget({
              type: 'terminal',
              terminal: highlightedItem.terminal,
              pr: highlightedItem.pr,
            })
            setHighlightedId(null)
            setMode('actions')
            return
          }
          if (highlightedItem.type === 'session') {
            e.preventDefault()
            setActionTarget({
              type: 'session',
              session: highlightedItem.session,
            })
            setHighlightedId(null)
            setMode('actions')
            return
          }
        }

        // In actions mode: open branches when "Branches" action is highlighted
        if (
          mode === 'actions' &&
          highlightedId === 'action:branches' &&
          actionTarget?.type === 'terminal'
        ) {
          e.preventDefault()
          setMode('branches')
          setBranches(null)
          setBranchesLoading(true)
          getBranches(actionTarget.terminal.id)
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
          return
        }

        // In branches mode: open branch-actions
        if (mode === 'branches' && highlightedId?.startsWith('branch:')) {
          e.preventDefault()
          const parts = highlightedId.split(':')
          const isRemote = parts[1] === 'remote'
          const branchName = parts.slice(2).join(':')
          const isCurrent =
            !isRemote &&
            branches?.local.some((b) => b.name === branchName && b.current)
          setSelectedBranch({
            name: branchName,
            isRemote,
            isCurrent: isCurrent ?? false,
          })
          setMode('branch-actions')
          setHighlightedId(null)
          return
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()

        if (
          mode === 'actions' ||
          mode === 'branch-actions' ||
          mode === 'search'
        )
          return

        // Handle cmd+enter in branches mode to open branch-actions
        if (mode === 'branches' && highlightedId?.startsWith('branch:')) {
          const parts = highlightedId.split(':')
          const isRemote = parts[1] === 'remote'
          const branchName = parts.slice(2).join(':')
          const isCurrent =
            !isRemote &&
            branches?.local.some((b) => b.name === branchName && b.current)
          setSelectedBranch({
            name: branchName,
            isRemote,
            isCurrent: isCurrent ?? false,
          })
          setMode('branch-actions')
          setHighlightedId(null)
          return
        }
      }
    },
    [
      mode,
      highlightedItem,
      highlightedId,
      branches,
      actionTarget,
      selectedBranch,
    ],
  )

  // Compute dirty state for the terminal if we're in branches mode
  const terminalDirtyStatus =
    actionTarget?.type === 'terminal'
      ? gitDirtyStatus[actionTarget.terminal.id]
      : undefined
  const isDirty =
    !!terminalDirtyStatus &&
    (terminalDirtyStatus.added > 0 || terminalDirtyStatus.removed > 0)

  const handleBranchSelect = useCallback(
    (branch: string, isRemote: boolean, isCurrent: boolean) => {
      if (!actionTarget || actionTarget.type !== 'terminal') return
      setSelectedBranch({ name: branch, isRemote, isCurrent })
      setMode('branch-actions')
      setHighlightedId(null)
    },
    [actionTarget],
  )

  const handleBranchCheckout = useCallback(async () => {
    if (!actionTarget || actionTarget.type !== 'terminal' || !selectedBranch)
      return
    if (selectedBranch.isCurrent || isDirty) return

    setCheckingOutBranch(selectedBranch.name)
    try {
      await checkoutBranch(
        actionTarget.terminal.id,
        selectedBranch.name,
        selectedBranch.isRemote,
      )
      toast.success(`Switched to ${selectedBranch.name}`)
      closePalette()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to checkout branch',
      )
    } finally {
      setCheckingOutBranch(null)
    }
  }, [actionTarget, selectedBranch, isDirty, closePalette])

  const handleBranchPull = useCallback(async () => {
    if (!actionTarget || actionTarget.type !== 'terminal' || !selectedBranch)
      return

    // Can only pull current branch if not dirty
    if (selectedBranch.isCurrent && isDirty) return

    setPullingBranch(selectedBranch.name)
    try {
      await pullBranch(actionTarget.terminal.id, selectedBranch.name)
      toast.success(`Pulled ${selectedBranch.name}`)
      closePalette()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to pull branch')
    } finally {
      setPullingBranch(null)
    }
  }, [actionTarget, selectedBranch, isDirty, closePalette])

  const handleBranchPush = useCallback(
    async (force?: boolean) => {
      if (!actionTarget || actionTarget.type !== 'terminal' || !selectedBranch)
        return

      // Can only push if not dirty
      if (isDirty) return

      setPushingBranch({ branch: selectedBranch.name, force: !!force })
      try {
        await pushBranch(actionTarget.terminal.id, selectedBranch.name, force)
        toast.success(
          force
            ? `Force pushed ${selectedBranch.name}`
            : `Pushed ${selectedBranch.name}`,
        )
        closePalette()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to push branch',
        )
      } finally {
        setPushingBranch(null)
      }
    },
    [actionTarget, selectedBranch, isDirty, closePalette],
  )

  const handleForcePushRequest = useCallback(() => {
    if (!actionTarget || actionTarget.type !== 'terminal' || !selectedBranch)
      return
    if (isDirty) return
    setForcePushConfirm({
      terminalId: actionTarget.terminal.id,
      branch: selectedBranch.name,
    })
  }, [actionTarget, selectedBranch, isDirty])

  const handleOpenBranches = useCallback(() => {
    if (!actionTarget || actionTarget.type !== 'terminal') return
    setMode('branches')
    setBranches(null)
    setBranchesLoading(true)
    getBranches(actionTarget.terminal.id)
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
  }, [actionTarget])

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-description="asd"
            className={cn(
              'fixed left-[50%] top-[20%] z-50 w-full translate-x-[-50%] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 transition-[max-width] duration-150',
              mode === 'branch-actions' ? 'max-w-2xl' : 'max-w-xl',
            )}
            onKeyDownCapture={handleKeyDown}
            onEscapeKeyDown={handleEscapeKeyDown}
          >
            <DialogPrimitive.Title className="sr-only">
              Command Palette
            </DialogPrimitive.Title>
            <Command
              key={mode}
              className="bg-transparent"
              value={highlightedId ?? ''}
              onValueChange={handleValueChange}
            >
              {mode === 'search' && (
                <SearchView
                  terminals={terminals}
                  openPRs={openPRs}
                  mergedPRs={mergedPRs}
                  sessions={sessions}
                  branchToPR={branchToPR}
                  onSelectTerminal={handleSelectTerminal}
                  onOpenTerminalActions={(terminal, pr) => {
                    setActionTarget({ type: 'terminal', terminal, pr })
                    setHighlightedId(null)
                    setMode('actions')
                  }}
                  onOpenSessionActions={(session) => {
                    setActionTarget({ type: 'session', session })
                    setHighlightedId(null)
                    setMode('actions')
                  }}
                  onSelectPR={handleSelectPR}
                />
              )}
              {mode === 'actions' && (
                <ActionsView
                  target={actionTarget}
                  onBack={() => {
                    const restoreId =
                      actionTarget?.type === 'terminal'
                        ? `t:${actionTarget.terminal.id}`
                        : actionTarget?.type === 'session'
                          ? `s:${actionTarget.session.session_id}`
                          : null
                    setMode('search')
                    setActionTarget(null)
                    setHighlightedId(restoreId)
                  }}
                  onRevealTerminal={(terminal) =>
                    handleSelectTerminal(terminal.id)
                  }
                  onRevealSession={(session) => {
                    selectSession(session.session_id)
                    closePalette()
                    window.dispatchEvent(
                      new CustomEvent('reveal-session', {
                        detail: { sessionId: session.session_id },
                      }),
                    )
                  }}
                  onOpenInCursor={handleOpenInCursor}
                  onOpenPR={handleOpenPR}
                  onClose={closePalette}
                  pinnedTerminalSessions={pinnedTerminalSessions}
                  setPinnedTerminalSessions={setPinnedTerminalSessions}
                  pinnedSessions={pinnedSessions}
                  setPinnedSessions={setPinnedSessions}
                  onAddWorkspace={async (terminal) => {
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
                        err instanceof Error
                          ? err.message
                          : 'Failed to add workspace',
                      )
                    }
                  }}
                  onEditTerminal={(terminal) => {
                    closePalette()
                    setTimeout(() => setEditTerminal(terminal), 150)
                  }}
                  onDeleteTerminal={(terminal) => {
                    closePalette()
                    setDeleteDirectory(false)
                    setTimeout(() => setDeleteTerminalTarget(terminal), 150)
                  }}
                  onRenameSession={(session) => {
                    closePalette()
                    setTimeout(() => setRenameSession(session), 150)
                  }}
                  onDeleteSession={(session) => {
                    closePalette()
                    setTimeout(() => setDeleteSessionTarget(session), 150)
                  }}
                  onOpenBranches={handleOpenBranches}
                />
              )}
              {mode === 'branches' && actionTarget?.type === 'terminal' && (
                <BranchesView
                  terminal={actionTarget.terminal}
                  branches={branches}
                  loading={branchesLoading}
                  onBack={() => {
                    setMode('actions')
                    setBranches(null)
                    setHighlightedId('action:branches')
                  }}
                  onSelectBranch={handleBranchSelect}
                />
              )}
              {mode === 'branch-actions' &&
                actionTarget?.type === 'terminal' &&
                selectedBranch && (
                  <BranchActionsView
                    terminal={actionTarget.terminal}
                    branch={selectedBranch}
                    branches={branches}
                    isDirty={isDirty}
                    checkingOut={checkingOutBranch === selectedBranch.name}
                    pulling={pullingBranch === selectedBranch.name}
                    pushing={
                      pushingBranch?.branch === selectedBranch.name &&
                      !pushingBranch.force
                    }
                    forcePushing={
                      pushingBranch?.branch === selectedBranch.name &&
                      pushingBranch.force
                    }
                    onBack={() => {
                      const prefix = selectedBranch.isRemote
                        ? 'remote'
                        : 'local'
                      setMode('branches')
                      setSelectedBranch(null)
                      setHighlightedId(
                        `branch:${prefix}:${selectedBranch.name}`,
                      )
                    }}
                    onCheckout={handleBranchCheckout}
                    onPull={handleBranchPull}
                    onPush={() => handleBranchPush(false)}
                    onForcePush={handleForcePushRequest}
                  />
                )}
            </Command>
            {mode === 'search' && (
              <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
                    <CornerDownLeft className="h-3 w-3" />
                  </kbd>
                  to select
                </span>
              </div>
            )}
            {mode === 'actions' && (
              <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
                    <CornerDownLeft className="h-3 w-3" />
                  </kbd>
                  to select
                </span>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

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
          message={`Are you sure you want to delete this session?`}
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
            handleBranchPush(true)
            setForcePushConfirm(null)
          }}
          onCancel={() => setForcePushConfirm(null)}
        />
      )}
    </>
  )
}

function SearchView({
  terminals,
  openPRs,
  mergedPRs,
  sessions,
  branchToPR,
  onSelectTerminal,
  onOpenTerminalActions,
  onOpenSessionActions,
  onSelectPR,
}: {
  terminals: Terminal[]
  openPRs: PRCheckStatus[]
  mergedPRs: {
    prNumber: number
    prTitle: string
    prUrl: string
    branch: string
    repo: string
  }[]
  sessions: SessionWithProject[]
  branchToPR: Map<string, PRCheckStatus>
  onSelectTerminal: (id: number) => void
  onOpenTerminalActions: (terminal: Terminal, pr: PRCheckStatus | null) => void
  onOpenSessionActions: (session: SessionWithProject) => void
  onSelectPR: (pr: { branch: string; repo: string }) => void
}) {
  return (
    <>
      <CommandInput
        placeholder="Search projects, PRs, Claude sessions..."
        autoFocus
      />
      <CommandList className="max-h-[360px]">
        <CommandEmpty>No results found.</CommandEmpty>

        {terminals.length > 0 && (
          <CommandGroup heading="Projects">
            {terminals.map((t) => {
              const matchedPR = t.git_branch
                ? (branchToPR.get(t.git_branch) ?? null)
                : null
              return (
                <CommandItem
                  className="cursor-pointer"
                  key={t.id}
                  value={`t:${t.id}`}
                  keywords={[
                    t.name ?? '',
                    t.cwd,
                    t.git_branch ?? '',
                    t.git_repo?.repo ?? '',
                  ]}
                  onSelect={() =>
                    t.ssh_host
                      ? onSelectTerminal(t.id)
                      : onOpenTerminalActions(t, matchedPR)
                  }
                >
                  <TerminalSquare className="h-4 w-4 shrink-0 text-zinc-400" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {t.name || getLastPathSegment(t.cwd)}
                    </span>
                    {t.git_branch && (
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
                          <GitBranch
                            className={cn(
                              'max-h-3 max-w-3 shrink-0 text-zinc-400',
                            )}
                          />
                          {t.git_branch}
                        </span>
                        {matchedPR && <PRTabButton pr={matchedPR} />}
                      </div>
                    )}
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {(openPRs.length > 0 || mergedPRs.length > 0) && (
          <CommandGroup heading="Pull Requests">
            {openPRs.map((pr) => {
              const prInfo = getPRStatusInfo(pr)
              return (
                <CommandItem
                  className="cursor-pointer group/cmd-pr"
                  key={`${pr.repo}-${pr.prNumber}`}
                  value={`pr:${pr.prNumber}:${pr.repo}`}
                  keywords={[pr.prTitle, pr.branch]}
                  onSelect={() => onSelectPR(pr)}
                >
                  {prInfo.icon?.()}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{pr.prTitle}</span>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
                        <GitBranch
                          className={cn(
                            'max-h-3 max-w-3 shrink-0 text-zinc-400',
                          )}
                        />
                        {pr.branch}
                      </span>
                      <PRTabButton pr={pr} />
                    </div>
                  </div>
                </CommandItem>
              )
            })}
            {mergedPRs.map((pr) => (
              <CommandItem
                className="cursor-pointer group/cmd-pr"
                key={`${pr.repo}-${pr.prNumber}`}
                value={`pr:${pr.prNumber}:${pr.repo}`}
                keywords={[pr.prTitle, pr.branch]}
                onSelect={() => window.open(pr.prUrl, '_blank')}
              >
                <GitMerge className="h-4 w-4 shrink-0 text-purple-500" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{pr.prTitle}</span>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
                      <GitBranch
                        className={cn('max-h-3 max-w-3 shrink-0 text-zinc-400')}
                      />
                      {pr.branch}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-purple-400">
                      Merged
                    </span>
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.length > 0 && (
          <CommandGroup heading="Claude Sessions">
            {sessions.map((s) => (
              <CommandItem
                className="cursor-pointer"
                key={s.session_id}
                value={`s:${s.session_id}`}
                keywords={[
                  s.name ?? '',
                  s.latest_user_message ?? '',
                  s.latest_agent_message ?? '',
                ]}
                onSelect={() => onOpenSessionActions(s)}
              >
                <SessionIcon status={s.status} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {s.name || s.latest_user_message || s.session_id}
                  </span>
                  {s.latest_agent_message && (
                    <span className="truncate text-xs text-zinc-500">
                      {s.latest_agent_message}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </>
  )
}

function ActionsView({
  target,
  onBack,
  onRevealTerminal,
  onRevealSession,
  onOpenInCursor,
  onOpenPR,
  onClose,
  pinnedTerminalSessions,
  setPinnedTerminalSessions,
  pinnedSessions,
  setPinnedSessions,
  onAddWorkspace,
  onEditTerminal,
  onDeleteTerminal,
  onRenameSession,
  onDeleteSession,
  onOpenBranches,
}: {
  target: ActionTarget | null
  onBack: () => void
  onRevealTerminal: (terminal: Terminal) => void
  onRevealSession: (session: SessionWithProject) => void
  onOpenInCursor: (terminal: Terminal) => void
  onOpenPR: (pr: PRCheckStatus) => void
  onClose: () => void
  pinnedTerminalSessions: number[]
  setPinnedTerminalSessions: (
    value: number[] | ((prev: number[]) => number[]),
  ) => void
  pinnedSessions: string[]
  setPinnedSessions: (value: string[] | ((prev: string[]) => string[])) => void
  onAddWorkspace: (terminal: Terminal) => void
  onEditTerminal: (terminal: Terminal) => void
  onDeleteTerminal: (terminal: Terminal) => void
  onRenameSession: (session: SessionWithProject) => void
  onDeleteSession: (session: SessionWithProject) => void
  onOpenBranches: () => void
}) {
  const title =
    target?.type === 'terminal'
      ? target?.terminal.name || getLastPathSegment(target?.terminal.cwd)
      : target?.session.name ||
        target?.session.latest_user_message ||
        target?.session.session_id

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-700 px-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm text-zinc-500 max-w-[200px]">
          {title}
        </span>
        <span className="shrink-0 text-zinc-600">/</span>
        <CommandInput
          wrapperCls="border-none px-0 min-w-0 flex-1"
          placeholder="Filter actions..."
          autoFocus
          className="border-0 px-0 focus-visible:ring-0"
        />
      </div>
      <CommandList>
        <CommandGroup>
          {target?.type === 'terminal' && (
            <TerminalActions
              target={target}
              onReveal={onRevealTerminal}
              onOpenInCursor={onOpenInCursor}
              onOpenPR={onOpenPR}
              onClose={onClose}
              pinnedTerminalSessions={pinnedTerminalSessions}
              setPinnedTerminalSessions={setPinnedTerminalSessions}
              onAddWorkspace={onAddWorkspace}
              onEditTerminal={onEditTerminal}
              onDeleteTerminal={onDeleteTerminal}
              onOpenBranches={onOpenBranches}
            />
          )}
          {target?.type === 'session' && (
            <SessionActions
              target={target}
              onReveal={onRevealSession}
              onClose={onClose}
              pinnedSessions={pinnedSessions}
              setPinnedSessions={setPinnedSessions}
              onRenameSession={onRenameSession}
              onDeleteSession={onDeleteSession}
            />
          )}
        </CommandGroup>
      </CommandList>
    </>
  )
}

function TerminalActions({
  target,
  onReveal,
  onOpenInCursor,
  onOpenPR,
  onClose,
  pinnedTerminalSessions,
  setPinnedTerminalSessions,
  onAddWorkspace,
  onEditTerminal,
  onDeleteTerminal,
  onOpenBranches,
}: {
  target: { type: 'terminal'; terminal: Terminal; pr: PRCheckStatus | null }
  onReveal: (terminal: Terminal) => void
  onOpenInCursor: (terminal: Terminal) => void
  onOpenPR: (pr: PRCheckStatus) => void
  onClose: () => void
  pinnedTerminalSessions: number[]
  setPinnedTerminalSessions: (
    value: number[] | ((prev: number[]) => number[]),
  ) => void
  onAddWorkspace: (terminal: Terminal) => void
  onEditTerminal: (terminal: Terminal) => void
  onDeleteTerminal: (terminal: Terminal) => void
  onOpenBranches: () => void
}) {
  const isPinned = pinnedTerminalSessions.includes(target.terminal.id)

  return (
    <>
      <CommandItem
        className="cursor-pointer"
        value="action:reveal"
        onSelect={() => onReveal(target.terminal)}
      >
        <Eye className="h-4 w-4 shrink-0 text-zinc-400" />
        <span>Reveal</span>
      </CommandItem>
      {!target.terminal.ssh_host && (
        <CommandItem
          className="cursor-pointer"
          value="action:cursor"
          onSelect={() => onOpenInCursor(target.terminal)}
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
          <span>Open in Cursor</span>
        </CommandItem>
      )}
      {target.pr && (
        <CommandItem
          className="cursor-pointer"
          value="action:open-pr"
          onSelect={() => {
            onOpenPR(target.pr!)
            onClose()
          }}
        >
          <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />
          <span>Open PR in new tab</span>
        </CommandItem>
      )}
      {target.terminal.git_repo && (
        <CommandItem
          className="cursor-pointer"
          value="action:branches"
          onSelect={onOpenBranches}
        >
          <GitFork className="h-4 w-4 shrink-0 text-zinc-400" />
          <span>Branches</span>
        </CommandItem>
      )}
      {target.terminal.git_repo && (
        <CommandItem
          className="cursor-pointer"
          value="action:add-workspace"
          onSelect={() => onAddWorkspace(target.terminal)}
        >
          <Copy className="h-4 w-4 shrink-0 text-zinc-400" />
          <span>Add Workspace</span>
        </CommandItem>
      )}
      <CommandItem
        className="cursor-pointer"
        value="action:pin"
        onSelect={() => {
          setPinnedTerminalSessions((prev) =>
            prev.includes(target.terminal.id)
              ? prev.filter((id) => id !== target.terminal.id)
              : [...prev, target.terminal.id],
          )
          onClose()
        }}
      >
        {isPinned ? (
          <PinOff className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <Pin className="h-4 w-4 shrink-0 text-zinc-400" />
        )}
        <span>{isPinned ? 'Unpin Latest Claude' : 'Pin Latest Claude'}</span>
      </CommandItem>
      <CommandItem
        className="cursor-pointer"
        value="action:edit"
        onSelect={() => onEditTerminal(target.terminal)}
      >
        <Pencil className="h-4 w-4 shrink-0 text-zinc-400" />
        <span>Edit</span>
      </CommandItem>
      <CommandItem
        className="cursor-pointer"
        value="action:delete"
        onSelect={() => onDeleteTerminal(target.terminal)}
      >
        <Trash2 className="h-4 w-4 shrink-0 text-red-400" />
        <span className="text-red-400">Delete</span>
      </CommandItem>
    </>
  )
}

function SessionActions({
  target,
  onReveal,
  onClose,
  pinnedSessions,
  setPinnedSessions,
  onRenameSession,
  onDeleteSession,
}: {
  target: { type: 'session'; session: SessionWithProject }
  onReveal: (session: SessionWithProject) => void
  onClose: () => void
  pinnedSessions: string[]
  setPinnedSessions: (value: string[] | ((prev: string[]) => string[])) => void
  onRenameSession: (session: SessionWithProject) => void
  onDeleteSession: (session: SessionWithProject) => void
}) {
  const isPinned = pinnedSessions.includes(target.session.session_id)

  return (
    <>
      <CommandItem
        className="cursor-pointer"
        value="action:reveal"
        onSelect={() => onReveal(target.session)}
      >
        <Eye className="h-4 w-4 shrink-0 text-zinc-400" />
        <span>Reveal</span>
      </CommandItem>
      <CommandItem
        className="cursor-pointer"
        value="action:pin"
        onSelect={() => {
          setPinnedSessions((prev) =>
            prev.includes(target.session.session_id)
              ? prev.filter((id) => id !== target.session.session_id)
              : [...prev, target.session.session_id],
          )
          onClose()
        }}
      >
        {isPinned ? (
          <PinOff className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <Pin className="h-4 w-4 shrink-0 text-zinc-400" />
        )}
        <span>{isPinned ? 'Unpin' : 'Pin'}</span>
      </CommandItem>
      <CommandItem
        className="cursor-pointer"
        value="action:rename"
        onSelect={() => onRenameSession(target.session)}
      >
        <Pencil className="h-4 w-4 shrink-0 text-zinc-400" />
        <span>Rename</span>
      </CommandItem>
      <CommandItem
        className="cursor-pointer"
        value="action:delete"
        onSelect={() => onDeleteSession(target.session)}
      >
        <Trash2 className="h-4 w-4 shrink-0 text-red-400" />
        <span className="text-red-400">Delete</span>
      </CommandItem>
    </>
  )
}

function BranchesView({
  terminal,
  branches,
  loading,
  onBack,
  onSelectBranch,
}: {
  terminal: Terminal
  branches: { local: BranchInfo[]; remote: BranchInfo[] } | null
  loading: boolean
  onBack: () => void
  onSelectBranch: (
    branch: string,
    isRemote: boolean,
    isCurrent: boolean,
  ) => void
}) {
  const title = terminal.name || getLastPathSegment(terminal.cwd)

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-700 px-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm text-zinc-500 max-w-[200px]">
          {title}
        </span>
        <span className="shrink-0 text-zinc-600">/</span>
        <span className="shrink-0 text-sm text-zinc-500">Branches</span>
        <span className="shrink-0 text-zinc-600">/</span>
        <CommandInput
          wrapperCls="border-none px-0 min-w-0 flex-1"
          placeholder="Filter branches..."
          autoFocus
          className="border-0 px-0 focus-visible:ring-0"
        />
      </div>
      <CommandList className="max-h-[360px]">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : branches ? (
          <>
            {branches.local.length > 0 && (
              <CommandGroup heading="Local Branches">
                {branches.local.map((branch) => (
                  <CommandItem
                    key={`local:${branch.name}`}
                    value={`branch:local:${branch.name}`}
                    className="cursor-pointer"
                    onSelect={() =>
                      onSelectBranch(branch.name, false, branch.current)
                    }
                  >
                    <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="flex-1 truncate">{branch.name}</span>
                    {branch.current && (
                      <Check className="h-4 w-4 shrink-0 text-green-500" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {branches.remote.length > 0 && (
              <CommandGroup heading="Remote Branches">
                {branches.remote.map((branch) => (
                  <CommandItem
                    key={`remote:${branch.name}`}
                    value={`branch:remote:${branch.name}`}
                    className="cursor-pointer"
                    onSelect={() => onSelectBranch(branch.name, true, false)}
                  >
                    <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="flex-1 truncate">{branch.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {branches.local.length === 0 && branches.remote.length === 0 && (
              <div className="py-6 text-center text-sm text-zinc-500">
                No branches found
              </div>
            )}
          </>
        ) : (
          <div className="py-6 text-center text-sm text-zinc-500">
            Failed to load branches
          </div>
        )}
      </CommandList>
      <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
            <CornerDownLeft className="h-3 w-3" />
          </kbd>
          to select
        </span>
      </div>
    </>
  )
}

function BranchActionsView({
  terminal,
  branch,
  branches,
  isDirty,
  checkingOut,
  pulling,
  pushing,
  forcePushing,
  onBack,
  onCheckout,
  onPull,
  onPush,
  onForcePush,
}: {
  terminal: Terminal
  branch: { name: string; isRemote: boolean; isCurrent: boolean }
  branches: { local: BranchInfo[]; remote: BranchInfo[] } | null
  isDirty: boolean
  checkingOut: boolean
  pulling: boolean
  pushing: boolean
  forcePushing: boolean
  onBack: () => void
  onCheckout: () => void
  onPull: () => void
  onPush: () => void
  onForcePush: () => void
}) {
  const title = terminal.name || getLastPathSegment(terminal.cwd)

  // Check if this local branch has a remote
  const hasRemote =
    branch.isRemote ||
    (branches?.remote.some((r) => r.name === branch.name) ?? false)

  // Any action in progress disables all other actions
  const isLoading = checkingOut || pulling || pushing || forcePushing

  // Can checkout if not current branch and not dirty
  const canCheckout = !branch.isCurrent && !isDirty && !isLoading

  // Can pull if:
  // - It's a remote branch (always)
  // - It's a local branch with remote AND (not current OR not dirty)
  const canPull = hasRemote && (!branch.isCurrent || !isDirty) && !isLoading

  // Can push if not dirty and not loading
  const canPush = !isDirty && !isLoading

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-700 px-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm text-zinc-500 max-w-[120px]">
          {title}
        </span>
        <span className="shrink-0 text-zinc-600">/</span>
        <span className="shrink-0 text-sm text-zinc-500">Branches</span>
        <span className="shrink-0 text-zinc-600">/</span>
        <span className="truncate text-sm text-zinc-500 max-w-[160px]">
          {branch.name}
        </span>
        <span className="shrink-0 text-zinc-600">/</span>
        <CommandInput
          placeholder="Filter actions..."
          autoFocus
          wrapperCls="border-none px-0 min-w-0 flex-1"
          className="border-0 px-0 focus-visible:ring-0"
        />
      </div>
      <CommandList>
        <CommandGroup>
          <CommandItem
            value="action:checkout"
            className="cursor-pointer"
            disabled={!canCheckout}
            onSelect={onCheckout}
          >
            <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />
            <span className={!canCheckout ? 'text-zinc-500' : ''}>
              Checkout
            </span>
            {!branch.isCurrent && isDirty && (
              <span className="text-xs text-yellow-500/80">
                (uncommitted changes)
              </span>
            )}
            {checkingOut && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
            )}
          </CommandItem>
          {hasRemote && (
            <CommandItem
              value="action:pull"
              className="cursor-pointer"
              disabled={!canPull}
              onSelect={onPull}
            >
              <ArrowDown className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className={!canPull ? 'text-zinc-500' : ''}>Pull</span>
              {branch.isCurrent && isDirty && (
                <span className="text-xs text-yellow-500/80">
                  (uncommitted changes)
                </span>
              )}
              {pulling && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
              )}
            </CommandItem>
          )}
          {!branch.isRemote && (
            <>
              <CommandItem
                value="action:push"
                className="cursor-pointer"
                disabled={!canPush}
                onSelect={onPush}
              >
                <ArrowUp className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className={isDirty ? 'text-zinc-500' : ''}>Push</span>
                {isDirty && (
                  <span className="text-xs text-yellow-500/80">
                    (uncommitted changes)
                  </span>
                )}
                {pushing && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                )}
              </CommandItem>
              <CommandItem
                value="action:force-push"
                className="cursor-pointer"
                disabled={!canPush}
                onSelect={onForcePush}
              >
                <ArrowUp className="h-4 w-4 shrink-0 text-red-400" />
                <span className={isDirty ? 'text-zinc-500' : ''}>
                  Force Push
                </span>
                {isDirty && (
                  <span className="text-xs text-yellow-500/80">
                    (uncommitted changes)
                  </span>
                )}
                {forcePushing && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                )}
              </CommandItem>
            </>
          )}
        </CommandGroup>
      </CommandList>
      <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
            <CornerDownLeft className="h-3 w-3" />
          </kbd>
          to select
        </span>
      </div>
    </>
  )
}
