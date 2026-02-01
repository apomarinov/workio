import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Command as CommandIcon,
  CornerDownLeft,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Loader2,
  TerminalSquare,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useSessionContext } from '@/context/SessionContext'
import { useTerminalContext } from '@/context/TerminalContext'
import type { PRCheckStatus } from '../../shared/types'
import type { SessionWithProject, Terminal } from '../types'

type Mode = 'search' | 'actions'

interface ActionTarget {
  terminal: Terminal
  pr: PRCheckStatus | null
}

function getLastPathSegment(cwd: string) {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

function getPRStatusLabel(pr: PRCheckStatus) {
  if (!pr.areAllChecksOk) return 'Failing'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'Changes'
  if (pr.reviewDecision === 'APPROVED') return 'Ready'
  return 'Open'
}

function getPRStatusColor(pr: PRCheckStatus) {
  if (!pr.areAllChecksOk) return 'text-red-400'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'text-yellow-400'
  if (pr.reviewDecision === 'APPROVED') return 'text-green-400'
  return 'text-blue-400'
}

function getPRIconColor(pr: PRCheckStatus) {
  if (pr.state === 'MERGED') return 'text-purple-400'
  if (pr.reviewDecision === 'APPROVED') return 'text-green-400'
  if (!pr.areAllChecksOk) return 'text-red-400'
  return 'text-blue-400'
}

function SessionIcon({ status }: { status: string }) {
  if (status === 'active')
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
  if (status === 'permission_needed')
    return <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
  if (status === 'done' || status === 'ended')
    return <Check className="h-4 w-4 shrink-0 text-green-400" />
  return <Bot className="h-4 w-4 shrink-0 text-zinc-400" />
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('search')
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)

  const { terminals, selectTerminal, githubPRs } = useTerminalContext()
  const { sessions, selectSession, clearSession } = useSessionContext()

  const openPRs = githubPRs.filter((pr) => pr.state === 'OPEN')

  // Build a map of branch -> PR for matching terminals to PRs
  const branchToPR = new Map<string, PRCheckStatus>()
  for (const pr of openPRs) {
    branchToPR.set(pr.branch, pr)
  }

  // Listen for the open-palette event
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-palette', handler)
    return () => window.removeEventListener('open-palette', handler)
  }, [])

  // Reset state when closing
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value)
    if (!value) {
      setMode('search')
      setActionTarget(null)
    }
  }, [])

  const closePalette = useCallback(() => {
    handleOpenChange(false)
  }, [handleOpenChange])

  // Scroll to the selected item in the sidebar after palette closes
  const scrollToSidebarItem = useCallback((selector: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(selector)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [])

  // Primary action handlers
  const handleSelectTerminal = useCallback(
    (id: number) => {
      selectTerminal(id)
      clearSession()
      closePalette()
      scrollToSidebarItem(`[data-terminal-id="${id}"]`)
    },
    [selectTerminal, clearSession, closePalette, scrollToSidebarItem],
  )

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectSession(sessionId)
      closePalette()
      scrollToSidebarItem(`[data-session-id="${sessionId}"]`)
    },
    [selectSession, closePalette, scrollToSidebarItem],
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

  // Secondary action: open in cursor
  const handleOpenInCursor = useCallback(
    (terminal: Terminal) => {
      window.open(`cursor://file/${terminal.cwd}`, '_blank')
      closePalette()
    },
    [closePalette],
  )

  // Read the currently highlighted cmdk item's value from the DOM
  const getSelectedValue = useCallback(() => {
    const el = document.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]',
    )
    return el?.getAttribute('data-value') ?? ''
  }, [])

  // Escape in actions mode: go back to search instead of closing
  const handleEscapeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (mode === 'actions') {
        e.preventDefault()
        setMode('search')
        setActionTarget(null)
      }
    },
    [mode],
  )

  // Keyboard handler for Cmd+Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd+Enter for secondary actions
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()

        if (mode === 'actions') {
          // In actions mode, just let the normal item selection happen
          return
        }

        const val = getSelectedValue()

        if (val.startsWith('terminal::')) {
          const id = Number(val.slice('terminal::'.length).split(' ')[0])
          const terminal = terminals.find((t) => t.id === id)
          if (!terminal || terminal.ssh_host) return
          const pr = terminal.git_branch
            ? (branchToPR.get(terminal.git_branch) ?? null)
            : null
          if (pr) {
            setActionTarget({ terminal, pr })
            setMode('actions')
          } else {
            handleOpenInCursor(terminal)
          }
          return
        }

        if (val.startsWith('pr::')) {
          const rest = val.slice('pr::'.length)
          const prNumber = Number(rest.split('::')[0])
          const repo = rest.split('::')[1]?.split(' ')[0]
          const pr = openPRs.find(
            (p) => p.prNumber === prNumber && p.repo === repo,
          )
          if (pr) {
            window.open(pr.prUrl, '_blank')
            closePalette()
          }
          return
        }

        // Session: no-op for Cmd+Enter
      }
    },
    [
      mode,
      getSelectedValue,
      terminals,
      branchToPR,
      openPRs,
      handleOpenInCursor,
      closePalette,
    ],
  )

  // Terminal items with deduplication against standalone PRs
  const terminalPRNumbers = new Set<string>()
  for (const t of terminals) {
    if (t.git_branch) {
      const pr = branchToPR.get(t.git_branch)
      if (pr) terminalPRNumbers.add(`${pr.repo}#${pr.prNumber}`)
    }
  }
  const standalonePRs = openPRs.filter(
    (pr) => !terminalPRNumbers.has(`${pr.repo}#${pr.prNumber}`),
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[20%] z-50 w-full max-w-xl translate-x-[-50%] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onKeyDownCapture={handleKeyDown}
          onEscapeKeyDown={handleEscapeKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">
            Command Palette
          </DialogPrimitive.Title>
          <Command key={mode} className="bg-transparent">
            {mode === 'search' ? (
              <SearchView
                terminals={terminals}
                standalonePRs={standalonePRs}
                sessions={sessions}
                branchToPR={branchToPR}
                onSelectTerminal={handleSelectTerminal}
                onSelectSession={handleSelectSession}
                onSelectPR={handleSelectPR}
              />
            ) : (
              <ActionsView
                target={actionTarget!}
                onBack={() => {
                  setMode('search')
                  setActionTarget(null)
                }}
                onOpenInCursor={handleOpenInCursor}
                onOpenPR={handleOpenPR}
                onClose={closePalette}
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
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1 py-1 text-zinc-400">
                <CommandIcon className="h-3 w-3" />
                <CornerDownLeft className="h-3 w-3" />
              </kbd>
              for actions
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SearchView({
  terminals,
  standalonePRs,
  sessions,
  branchToPR,
  onSelectTerminal,
  onSelectSession,
  onSelectPR,
}: {
  terminals: Terminal[]
  standalonePRs: PRCheckStatus[]
  sessions: SessionWithProject[]
  branchToPR: Map<string, PRCheckStatus>
  onSelectTerminal: (id: number) => void
  onSelectSession: (id: string) => void
  onSelectPR: (pr: PRCheckStatus) => void
}) {
  return (
    <>
      <CommandInput placeholder="Search terminals, PRs, sessions…" autoFocus />
      <CommandList className="max-h-[360px]">
        <CommandEmpty>No results found.</CommandEmpty>

        {terminals.length > 0 && (
          <CommandGroup heading="Terminals">
            {terminals.map((t) => {
              const matchedPR = t.git_branch
                ? (branchToPR.get(t.git_branch) ?? null)
                : null
              return (
                <CommandItem
                  className='cursor-pointer'
                  key={`terminal-${t.id}`}
                  value={`terminal::${t.id} ${t.name ?? ''} ${t.cwd} ${t.git_branch ?? ''}`}
                  onSelect={() => onSelectTerminal(t.id)}
                >
                  <TerminalSquare className="h-4 w-4 shrink-0 text-zinc-400" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {t.name || getLastPathSegment(t.cwd)}
                    </span>
                    {t.git_branch && (
                      <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
                        <GitBranch className="max-h-3 max-w-3 shrink-0" />
                        {t.git_branch}
                      </span>
                    )}
                  </div>
                  {matchedPR && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${getPRStatusColor(matchedPR)} bg-zinc-800`}
                    >
                      PR
                    </span>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {standalonePRs.length > 0 && (
          <CommandGroup heading="Pull Requests">
            {standalonePRs.map((pr) => (
              <CommandItem
                className='cursor-pointer'
                key={`pr-${pr.repo}-${pr.prNumber}`}
                value={`pr::${pr.prNumber}::${pr.repo} ${pr.prTitle} ${pr.branch}`}
                onSelect={() => onSelectPR(pr)}
              >
                <GitPullRequest
                  className={`h-4 w-4 shrink-0 ${getPRIconColor(pr)}`}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{pr.prTitle}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
                    <GitBranch className="max-h-3 max-w-3 shrink-0" />
                    {pr.branch}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${getPRStatusColor(pr)} bg-zinc-800`}
                >
                  {getPRStatusLabel(pr)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((s) => (
              <CommandItem
                className='cursor-pointer'
                key={`session-${s.session_id}`}
                value={`session::${s.session_id} ${s.name ?? ''} ${s.latest_user_message ?? ''} ${s.latest_agent_message ?? ''}`}
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
}: {
  target: ActionTarget
  onBack: () => void
  onOpenInCursor: (terminal: Terminal) => void
  onOpenPR: (pr: PRCheckStatus) => void
  onClose: () => void
}) {
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
        <span className="text-sm font-medium text-zinc-200">
          {target.terminal.name || getLastPathSegment(target.terminal.cwd)}
        </span>
      </div>
      <CommandList>
        <CommandGroup>
          {!target.terminal.ssh_host && (
            <CommandItem
              className='cursor-pointer'
              value="action::cursor"
              onSelect={() => {
                onOpenInCursor(target.terminal)
              }}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
              <span>Open in Cursor</span>
            </CommandItem>
          )}
          {target.pr && (
            <CommandItem
              className='cursor-pointer'
              value="action::open-pr"
              onSelect={() => {
                onOpenPR(target.pr!)
                onClose()
              }}
            >
              <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />
              <span>Open PR in new tab</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </>
  )
}
