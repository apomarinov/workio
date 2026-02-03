import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Command as CommandIcon,
  Copy,
  CornerDownLeft,
  ExternalLink,
  FolderOpen,
  GitBranch,
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
import { useSessionContext } from '@/context/SessionContext'
import { useTerminalContext } from '@/context/TerminalContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../shared/types'
import type { SessionWithProject, Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { EditSessionModal } from './EditSessionModal'
import { EditTerminalModal } from './EditTerminalModal'
import { getPRStatusInfo, PRTabButton } from './PRStatusContent'

type Mode = 'search' | 'actions'

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
  const { itemMap, firstId } = useMemo(() => {
    const map = new Map<string, ItemInfo>()

    let first: string | null = null

    for (const t of terminals) {
      const pr = t.git_branch ? (branchToPR.get(t.git_branch) ?? null) : null

      const id = `t:${t.id}`
      if (!first) first = id
      map.set(id, {
        type: 'terminal',
        terminal: t,
        pr,
        actionHint: t.ssh_host ? null : 'For actions',
      })
    }

    for (const pr of openPRs) {
      const id = `pr:${pr.prNumber}:${pr.repo}`
      if (!first) first = id
      map.set(id, { type: 'pr', pr, actionHint: 'Open PR in new tab' })
    }

    for (const s of sessions) {
      const id = `s:${s.session_id}`
      if (!first) first = id
      map.set(id, { type: 'session', session: s, actionHint: 'For actions' })
    }

    return { itemMap: map, firstId: first }
  }, [terminals, openPRs, sessions, branchToPR])

  // Resolve the currently highlighted item
  const highlightedItem = highlightedId
    ? (itemMap.get(highlightedId) ?? null)
    : null

  useEffect(() => {
    const handler = () => setOpen(true)
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

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
    if (!value) {
      setActionTarget(null)
      setHighlightedId(null)
    } else {
      setMode('search')
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

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectSession(sessionId)
      closePalette()
      window.dispatchEvent(
        new CustomEvent('reveal-session', { detail: { sessionId } }),
      )
    },
    [selectSession, closePalette],
  )

  const handleSelectPR = useCallback(
    (pr: PRCheckStatus) => {
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
        setMode('search')
        setActionTarget(null)
        setHighlightedId(null)
        return
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()

        if (mode === 'actions') return

        if (!highlightedItem) return

        if (highlightedItem.type === 'terminal') {
          if (highlightedItem.terminal.ssh_host) return
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
          setActionTarget({
            type: 'session',
            session: highlightedItem.session,
          })
          setHighlightedId(null)
          setMode('actions')
          return
        }

        if (highlightedItem.type === 'pr') {
          window.open(highlightedItem.pr.prUrl, '_blank')
          closePalette()
          return
        }
      }
    },
    [mode, highlightedItem, closePalette],
  )

  const actionHint =
    mode === 'actions'
      ? null
      : highlightedItem
        ? highlightedItem.actionHint
        : firstId
          ? (itemMap.get(firstId)?.actionHint ?? null)
          : null

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-description="asd"
            className="fixed left-[50%] top-[20%] z-50 w-full max-w-xl translate-x-[-50%] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
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
              {mode === 'search' ? (
                <SearchView
                  terminals={terminals}
                  openPRs={openPRs}
                  sessions={sessions}
                  branchToPR={branchToPR}
                  onSelectTerminal={handleSelectTerminal}
                  onSelectSession={handleSelectSession}
                  onSelectPR={handleSelectPR}
                />
              ) : (
                <ActionsView
                  target={actionTarget}
                  onBack={() => {
                    setMode('search')
                    setActionTarget(null)
                    setHighlightedId(null)
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
                />
              )}
            </Command>
            <div className="flex items-center justify-between border-t border-zinc-700 px-3 py-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
                  <CornerDownLeft className="h-3 w-3" />
                </kbd>
                to select
              </span>
              {actionHint && (
                <span className="flex items-center gap-1.5">
                  {actionHint}
                  <kbd className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1 py-1 text-zinc-400">
                    <CommandIcon className="h-3 w-3" />
                    <CornerDownLeft className="h-3 w-3" />
                  </kbd>
                </span>
              )}
            </div>
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
    </>
  )
}

function SearchView({
  terminals,
  openPRs,
  sessions,
  branchToPR,
  onSelectTerminal,
  onSelectSession,
  onSelectPR,
}: {
  terminals: Terminal[]
  openPRs: PRCheckStatus[]
  sessions: SessionWithProject[]
  branchToPR: Map<string, PRCheckStatus>
  onSelectTerminal: (id: number) => void
  onSelectSession: (id: string) => void
  onSelectPR: (pr: PRCheckStatus) => void
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
                  onSelect={() => onSelectTerminal(t.id)}
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

        {openPRs.length > 0 && (
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
                onSelect={() => onSelectSession(s.session_id)}
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
}: {
  target: ActionTarget | null
  onBack: () => void
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
}) {
  const title =
    target?.type === 'terminal'
      ? target?.terminal.name || getLastPathSegment(target?.terminal.cwd)
      : target?.session.name ||
        target?.session.latest_user_message ||
        target?.session.session_id

  return (
    <>
      <div className="h-0 overflow-hidden">
        <CommandInput autoFocus />
      </div>
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-0.5 text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-medium text-zinc-200">
          {title}
        </span>
      </div>
      <CommandList>
        <CommandGroup>
          {target?.type === 'terminal' && (
            <TerminalActions
              target={target}
              onOpenInCursor={onOpenInCursor}
              onOpenPR={onOpenPR}
              onClose={onClose}
              pinnedTerminalSessions={pinnedTerminalSessions}
              setPinnedTerminalSessions={setPinnedTerminalSessions}
              onAddWorkspace={onAddWorkspace}
              onEditTerminal={onEditTerminal}
              onDeleteTerminal={onDeleteTerminal}
            />
          )}
          {target?.type === 'session' && (
            <SessionActions
              target={target}
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
  onOpenInCursor,
  onOpenPR,
  onClose,
  pinnedTerminalSessions,
  setPinnedTerminalSessions,
  onAddWorkspace,
  onEditTerminal,
  onDeleteTerminal,
}: {
  target: { type: 'terminal'; terminal: Terminal; pr: PRCheckStatus | null }
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
}) {
  const isPinned = pinnedTerminalSessions.includes(target.terminal.id)

  return (
    <>
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
  onClose,
  pinnedSessions,
  setPinnedSessions,
  onRenameSession,
  onDeleteSession,
}: {
  target: { type: 'session'; session: SessionWithProject }
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
