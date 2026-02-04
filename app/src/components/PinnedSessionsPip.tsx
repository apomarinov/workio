import { Maximize2, Minus, MoreVertical, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useDocumentPip } from '../context/DocumentPipContext'
import { useSessionContext } from '../context/SessionContext'
import { useTerminalContext } from '../context/TerminalContext'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { SessionWithProject } from '../types'
import { SessionItem } from './SessionItem'

const PIP_CARD_WIDTH = {
  vertical: 500,
  horizontal: 350,
}
const PIP_ELEMENT_ID = 'pinned-sessions-pip'

// Module-level ref for the hidden measurement div
let measureEl: HTMLDivElement | null = null

export function getPipDimensions(layout: 'horizontal' | 'vertical'): {
  width: number
  height: number
  left?: number
  top?: number
} | null {
  if (!measureEl) return null
  const width = Math.min(measureEl.scrollWidth, screen.width)
  const height = Math.min(measureEl.scrollHeight, screen.height)
  if (layout === 'vertical') {
    return {
      width,
      height,
      left: screen.width - width,
      top: 0,
    }
  }
  return { width, height: height }
}

export function usePinnedSessionsData() {
  const { sessions } = useSessionContext()
  const { terminals } = useTerminalContext()
  const [rawPinnedSessionIds, setRawPinnedSessionIds] = useLocalStorage<
    string[]
  >('sidebar-pinned-sessions', [])
  const [rawPinnedTerminalIds, setRawPinnedTerminalIds] = useLocalStorage<
    number[]
  >('sidebar-pinned-terminal-sessions', [])

  // Validate pinned session IDs against actual sessions
  const pinnedSessionIds = useMemo(() => {
    const sessionIdSet = new Set(sessions.map((s) => s.session_id))
    return rawPinnedSessionIds.filter((id) => sessionIdSet.has(id))
  }, [sessions, rawPinnedSessionIds])

  // Validate pinned terminal IDs against actual terminals
  const pinnedTerminalIds = useMemo(() => {
    const terminalIdSet = new Set(terminals.map((t) => t.id))
    return rawPinnedTerminalIds.filter((id) => terminalIdSet.has(id))
  }, [terminals, rawPinnedTerminalIds])

  // Clean up stale IDs from localStorage
  useEffect(() => {
    if (pinnedSessionIds.length < rawPinnedSessionIds.length) {
      setRawPinnedSessionIds(pinnedSessionIds)
    }
  }, [pinnedSessionIds, rawPinnedSessionIds, setRawPinnedSessionIds])

  useEffect(() => {
    if (pinnedTerminalIds.length < rawPinnedTerminalIds.length) {
      setRawPinnedTerminalIds(pinnedTerminalIds)
    }
  }, [pinnedTerminalIds, rawPinnedTerminalIds, setRawPinnedTerminalIds])

  // Get pinned sessions (directly pinned + latest from pinned terminals)
  const { pinnedSessions, pinnedSessionIdSet } = useMemo(() => {
    const result: SessionWithProject[] = []
    const addedIds = new Set<string>()

    // Directly pinned sessions
    for (const id of pinnedSessionIds) {
      const session = sessions.find((s) => s.session_id === id)
      if (session && !addedIds.has(session.session_id)) {
        result.push(session)
        addedIds.add(session.session_id)
      }
    }

    // Latest session per pinned terminal
    for (const terminalId of pinnedTerminalIds) {
      const terminal = terminals.find((t) => t.id === terminalId)
      if (!terminal) continue
      const terminalSessions = sessions
        .filter((s) => s.terminal_id === terminalId)
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
      const latest = terminalSessions[0]
      if (latest && !addedIds.has(latest.session_id)) {
        result.push(latest)
        addedIds.add(latest.session_id)
      }
    }

    // Sort pinned by updated_at descending
    result.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )

    return { pinnedSessions: result, pinnedSessionIdSet: addedIds }
  }, [sessions, terminals, pinnedSessionIds, pinnedTerminalIds])

  // Get non-pinned sessions sorted by updated_at
  const nonPinnedSessions = useMemo(() => {
    return sessions
      .filter((s) => !pinnedSessionIdSet.has(s.session_id))
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
  }, [sessions, pinnedSessionIdSet])

  return {
    pinnedSessions,
    nonPinnedSessions,
    allSessions: sessions,
    pinnedSessionIds,
    pinnedTerminalIds,
    totalCount: pinnedSessionIds.length + pinnedTerminalIds.length,
  }
}

function SettingsMenu({
  layout,
  setLayout,
  maxSessions,
  setMaxSessions,
  portalContainer,
  open,
  setOpen,
}: {
  layout: 'horizontal' | 'vertical'
  setLayout: (v: 'horizontal' | 'vertical') => void
  maxSessions: number
  setMaxSessions: (v: number) => void
  portalContainer?: HTMLElement | null
  open: boolean
  setOpen: (v: boolean) => void
}) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-zinc-400 hover:text-zinc-200"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-52 p-2 space-y-2"
        container={portalContainer}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Max sessions</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setMaxSessions(Math.max(0, maxSessions - 1))}
            >
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-xs w-6 text-center tabular-nums">
              {maxSessions === 0 ? 'All' : maxSessions}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setMaxSessions(maxSessions + 1)}
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Layout</span>
          <div className="flex gap-1">
            <Button
              variant={layout === 'horizontal' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={() => {
                setLayout('horizontal')
                setOpen(false)
              }}
            >
              Horizontal
            </Button>
            <Button
              variant={layout === 'vertical' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={() => {
                setLayout('vertical')
                setOpen(false)
              }}
            >
              Vertical
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function PinnedSessionsPip() {
  const pip = useDocumentPip()
  const { terminals } = useTerminalContext()
  const { pinnedSessions, nonPinnedSessions, allSessions } =
    usePinnedSessionsData()

  const getTerminalName = useCallback(
    (terminalId: number | null) => {
      if (!terminalId) return null
      const t = terminals.find((t) => t.id === terminalId)
      return t ? t.name || t.cwd || null : null
    },
    [terminals],
  )
  const [layout, setLayout] = useLocalStorage<'horizontal' | 'vertical'>(
    'pip-layout',
    'horizontal',
  )
  const [maxSessions, setMaxSessions] = useLocalStorage<number>(
    'pip-max-sessions',
    0,
  )
  const [isHoveringMenu, setIsHoveringMenu] = useState(false)
  const [openMenu, setOpenMenu] = useState(false)

  // Auto-close PiP when there are no sessions
  useEffect(() => {
    if (pip.isOpen && allSessions.length === 0) {
      pip.close(PIP_ELEMENT_ID)
    }
  }, [allSessions.length, pip.isOpen, pip.close])

  // Close PiP on Escape key press inside the PiP window
  useEffect(() => {
    const pipWin = pip.window
    if (!pipWin) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        pip.closeAll()
      }
    }
    pipWin.addEventListener('keydown', handleKeyDown)
    return () => pipWin.removeEventListener('keydown', handleKeyDown)
  }, [pip.window, pip.closeAll])

  const displayedSessions = useMemo(() => {
    // Combine pinned first, then non-pinned, deduped by session_id
    const seen = new Set<string>()
    const combined: SessionWithProject[] = []

    for (const session of pinnedSessions) {
      if (!seen.has(session.session_id)) {
        seen.add(session.session_id)
        combined.push(session)
      }
    }

    for (const session of nonPinnedSessions) {
      if (!seen.has(session.session_id)) {
        seen.add(session.session_id)
        combined.push(session)
      }
    }

    // If maxSessions is 0 ("All"), show last 5; otherwise use maxSessions
    const limit = maxSessions === 0 ? 5 : maxSessions
    return combined.slice(0, limit)
  }, [pinnedSessions, nonPinnedSessions, maxSessions])

  const resizePip = useCallback(
    (l: 'horizontal' | 'vertical') => {
      const dims = getPipDimensions(l)
      if (!dims) return
      try {
        pip.resize({ width: dims.width, height: dims.height + 34 })
        if (dims.left !== undefined) {
          pip.moveTo(dims.left, dims.top ?? 0)
        }
      } catch {
        // resizeTo may require user activation in PiP
      }
    },
    [pip],
  )

  const handleSetLayout = useCallback(
    (v: 'horizontal' | 'vertical') => {
      flushSync(() => setLayout(v))
      resizePip(v)
    },
    [setLayout, resizePip],
  )

  const handleSetMaxSessions = useCallback(
    (v: number) => {
      flushSync(() => setMaxSessions(v))
      resizePip(layout)
    },
    [layout, setMaxSessions, resizePip],
  )

  const handleFit = useCallback(() => {
    resizePip(layout)
  }, [layout, resizePip])

  const pipContainer = pip.getContainer(PIP_ELEMENT_ID)

  return (
    <>
      {/* Hidden measurement div rendered in the main document.
          Mirrors the PiP sessions layout so we can measure ideal dimensions. */}
      <div
        ref={(el) => {
          measureEl = el
        }}
        aria-hidden
        className="fixed top-0 left-0 invisible pointer-events-none hidden-sessions"
        style={{ maxWidth: '100vw', maxHeight: '100vh' }}
      >
        <div
          className={cn(
            'flex gap-2 px-2',
            layout === 'horizontal' ? 'flex-row' : 'flex-col',
          )}
        >
          {displayedSessions.map((session) => (
            <div
              key={session.session_id}
              className="flex-shrink-0"
              style={{ width: PIP_CARD_WIDTH[layout] }}
            >
              <SessionItem
                session={session}
                terminalName={getTerminalName(session.terminal_id)}
                popoverContainer={document.body}
              />
            </div>
          ))}
        </div>
      </div>

      {/* PiP portal content */}
      {pipContainer &&
        createPortal(
          <div className="relative h-full w-full flex max-w-[100vw] max-h-[100vh]">
            <div
              className="rounded-tl-md w-[90vw] h-10 absolute top-0 left-0 z-30"
              onMouseEnter={() => setIsHoveringMenu(true)}
              onMouseLeave={() => setIsHoveringMenu(openMenu)}
            >
              <div
                onMouseLeave={() => setIsHoveringMenu(false)}
                className={cn(
                  'transition-all translate-y-[-45px]',
                  (isHoveringMenu || openMenu) && 'flex translate-y-0',
                )}
              >
                <div className="flex-row border-[2px] !border-t-[0px] border-sidebar-accent flex rounded-b-lg px-2 py-1.5 w-fit h-fit items-start gap-2 bg-sidebar mx-auto">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-zinc-400 hover:text-zinc-200"
                    onClick={handleFit}
                    title="Fit to content"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </Button>
                  <SettingsMenu
                    open={openMenu}
                    setOpen={(v) => {
                      setOpenMenu(v)
                      if (!v) {
                        setIsHoveringMenu(false)
                      }
                    }}
                    layout={layout}
                    setLayout={handleSetLayout}
                    maxSessions={maxSessions}
                    setMaxSessions={handleSetMaxSessions}
                    portalContainer={pipContainer}
                  />
                </div>
              </div>
            </div>
            <div
              className={cn(
                'flex gap-2 h-full w-full',
                layout === 'horizontal'
                  ? 'flex-row overflow-x-auto items-stretch'
                  : 'flex-col overflow-y-auto',
              )}
            >
              {displayedSessions.map((session) => (
                <div
                  key={session.session_id}
                  className="flex-shrink-0 max-w-[100vw] pinned-sessions"
                  style={{
                    width:
                      layout === 'vertical' ? '100vw' : PIP_CARD_WIDTH[layout],
                    maxWidth: '100vw',
                  }}
                >
                  <SessionItem
                    session={session}
                    popoverContainer={pipContainer}
                    terminalName={getTerminalName(session.terminal_id)}
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent('reveal-session', {
                          detail: { sessionId: session.session_id },
                        }),
                      )
                    }}
                  />
                </div>
              ))}
            </div>
          </div>,
          pipContainer,
        )}
    </>
  )
}
