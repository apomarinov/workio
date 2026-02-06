import {
  Maximize2,
  Minimize2,
  Minus,
  MoreVertical,
  Mouse,
  Plus,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { groupMessages } from '@/lib/messageUtils'
import { cn } from '@/lib/utils'
import { useDocumentPip } from '../context/DocumentPipContext'
import { useSessionContext } from '../context/SessionContext'
import { useTerminalContext } from '../context/TerminalContext'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSessionMessages } from '../hooks/useSessionMessages'
import { useSettings } from '../hooks/useSettings'
import type {
  SessionMessage,
  SessionWithProject,
  TodoWriteTool,
} from '../types'
import { MessageBubble, ThinkingGroup } from './MessageBubble'
import { SessionItem } from './SessionItem'

const PIP_CARD_WIDTH = {
  vertical: 500,
  horizontal: 350,
}
const PIP_CHAT_HEIGHT = 300
const PIP_ELEMENT_ID = 'pinned-sessions-pip'

// Module-level ref for the hidden measurement div
let measureEl: HTMLDivElement | null = null

function PipChatItem({
  session,
  layout,
  isFullscreen,
  isFocused,
  onFocus,
  onToggleFullscreen,
}: {
  session: SessionWithProject
  layout: 'horizontal' | 'vertical'
  isFullscreen: boolean
  isFocused: boolean
  onFocus: () => void
  onToggleFullscreen: () => void
}) {
  const { settings } = useSettings()
  const { messages, loading } = useSessionMessages(session.session_id)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const isInitialLoadRef = useRef(true)

  // Filter messages
  const filteredMessages = useMemo(() => {
    let result = messages

    if (settings?.show_tools === false) {
      result = result.filter((m) => !m.tools || m.todo_id)
    }

    const hasRecentIncompleteTodos = (m: SessionMessage) => {
      if (m.tools?.name !== 'TodoWrite') return false
      const tool = m.tools as TodoWriteTool
      const hasIncomplete = tool.input.todos?.some(
        (t) => t.status !== 'completed',
      )
      if (!hasIncomplete) return false
      const updatedAt = m.updated_at || m.created_at
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      return new Date(updatedAt).getTime() > fiveMinutesAgo
    }

    const incompleteTodoMsg = result.find(hasRecentIncompleteTodos)
    if (incompleteTodoMsg) {
      result = [
        ...result.filter((m) => m !== incompleteTodoMsg),
        incompleteTodoMsg,
      ]
    }

    return result
  }, [messages, settings?.show_tools])

  const groupedMessages = useMemo(
    () => groupMessages(filteredMessages),
    [filteredMessages],
  )

  // Handle scroll position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const threshold = 100
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    isNearBottomRef.current = distanceFromBottom < threshold
  }, [])

  // Reset on session change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on session change
  useEffect(() => {
    isInitialLoadRef.current = true
    isNearBottomRef.current = true
  }, [session.session_id])

  // Scroll to bottom
  useEffect(() => {
    if (!loading && messages.length > 0 && scrollContainerRef.current) {
      if (isInitialLoadRef.current) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight
        isInitialLoadRef.current = false
      } else if (
        messages.length > prevMessageCountRef.current &&
        isNearBottomRef.current
      ) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight
      }
      prevMessageCountRef.current = messages.length
    }
  }, [loading, messages.length])

  // Handle click: cmd+click for fullscreen, normal click for focus
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        onToggleFullscreen()
      } else if (!isFocused) {
        e.stopPropagation()
        onFocus()
      }
    },
    [onToggleFullscreen, isFocused, onFocus],
  )

  const height = isFullscreen
    ? '100vh'
    : layout === 'horizontal'
      ? '100%'
      : `${PIP_CHAT_HEIGHT}px`

  return (
    <div
      onClick={handleClick}
      className={cn(
        'group/chat relative flex flex-col bg-sidebar rounded-lg border overflow-hidden transition-colors',
        isFocused ? 'border-green-500' : 'border-sidebar-border cursor-pointer',
        isFullscreen && 'fixed inset-0 z-50 rounded-none border-none',
      )}
      style={{
        height,
        width: isFullscreen
          ? '100vw'
          : layout === 'vertical'
            ? '100%'
            : PIP_CARD_WIDTH[layout],
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-sidebar-border flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-medium text-zinc-100 truncate">
            {session.name || 'Untitled'}
          </h3>
        </div>
        {session.status === 'active' && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 300 150"
            className="w-4 h-4 flex-shrink-0"
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
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn(
          'flex-1 px-3 py-3',
          isFocused ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 300 150"
              className="w-6 h-6"
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
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
            No messages
          </div>
        ) : (
          <div className="space-y-2">
            {groupedMessages.map((item) =>
              item.type === 'thinking' ? (
                <ThinkingGroup
                  key={`thinking-${item.messages[0].id}`}
                  messages={item.messages}
                />
              ) : (
                <MessageBubble key={item.message.id} message={item.message} />
              ),
            )}
          </div>
        )}
      </div>

      {/* Bottom-right overlay */}
      {isFocused ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFullscreen()
          }}
          className={cn(
            'absolute bottom-2 right-2 p-1.5 rounded bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-all',
            'opacity-0 group-hover/chat:opacity-100',
            isFullscreen && 'opacity-100',
          )}
          title={
            isFullscreen ? 'Exit fullscreen (⌘+click)' : 'Fullscreen (⌘+click)'
          }
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      ) : (
        <div
          className={cn(
            'absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-1 rounded bg-zinc-800/80 text-zinc-500 transition-all',
            'opacity-0 group-hover/chat:opacity-100',
          )}
        >
          <Mouse className="w-3 h-3" />
          <span className="text-[10px]">Click to scroll</span>
        </div>
      )}
    </div>
  )
}

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
  mode,
  setMode,
  maxSessions,
  setMaxSessions,
  portalContainer,
  open,
  setOpen,
}: {
  layout: 'horizontal' | 'vertical'
  setLayout: (v: 'horizontal' | 'vertical') => void
  mode: 'sessions' | 'chat'
  setMode: (v: 'sessions' | 'chat') => void
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Mode</span>
          <div className="flex gap-1">
            <Button
              variant={mode === 'sessions' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={() => {
                setMode('sessions')
                setOpen(false)
              }}
            >
              Sessions
            </Button>
            <Button
              variant={mode === 'chat' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={() => {
                setMode('chat')
                setOpen(false)
              }}
            >
              Chat
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
  const [mode, setMode] = useLocalStorage<'sessions' | 'chat'>(
    'pip-mode',
    'sessions',
  )
  const [isHoveringMenu, setIsHoveringMenu] = useState(false)
  const [openMenu, setOpenMenu] = useState(false)
  const [fullscreenSessionId, setFullscreenSessionId] = useState<string | null>(
    null,
  )
  const [focusedChatId, setFocusedChatId] = useState<string | null>(null)

  // Auto-close PiP when there are no sessions
  useEffect(() => {
    if (pip.isOpen && allSessions.length === 0) {
      pip.close(PIP_ELEMENT_ID)
    }
  }, [allSessions.length, pip.isOpen, pip.close])

  // Escape: unfocus chat first, then close PiP. Blur: unfocus chat.
  useEffect(() => {
    const pipWin = pip.window
    if (!pipWin) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (focusedChatId) {
          setFocusedChatId(null)
        } else {
          pip.closeAll()
        }
      }
    }
    const handleBlur = () => setFocusedChatId(null)
    pipWin.addEventListener('keydown', handleKeyDown)
    pipWin.addEventListener('blur', handleBlur)
    return () => {
      pipWin.removeEventListener('keydown', handleKeyDown)
      pipWin.removeEventListener('blur', handleBlur)
    }
  }, [pip.window, pip.closeAll, focusedChatId])

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

  const handleSetMode = useCallback(
    (v: 'sessions' | 'chat') => {
      flushSync(() => setMode(v))
      setFullscreenSessionId(null)
      setFocusedChatId(null)
      resizePip(layout)
    },
    [setMode, resizePip, layout],
  )

  const handleFit = useCallback(() => {
    resizePip(layout)
  }, [layout, resizePip])

  const toggleFullscreen = useCallback((sessionId: string) => {
    setFullscreenSessionId((prev) => (prev === sessionId ? null : sessionId))
  }, [])

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
              style={{
                width: PIP_CARD_WIDTH[layout],
                height: mode === 'chat' ? PIP_CHAT_HEIGHT : undefined,
              }}
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
                    <Minimize2 className="w-3.5 h-3.5" />
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
                    mode={mode}
                    setMode={handleSetMode}
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
              {mode === 'sessions'
                ? displayedSessions.map((session) => (
                    <div
                      key={session.session_id}
                      className="flex-shrink-0 max-w-[100vw] pinned-sessions"
                      style={{
                        width:
                          layout === 'vertical'
                            ? '100vw'
                            : PIP_CARD_WIDTH[layout],
                        maxWidth: '100vw',
                      }}
                    >
                      <SessionItem
                        session={session}
                        terminalName={getTerminalName(session.terminal_id)}
                        popoverContainer={pipContainer}
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent('reveal-session', {
                              detail: { sessionId: session.session_id },
                            }),
                          )
                        }}
                      />
                    </div>
                  ))
                : displayedSessions.map((session) => (
                    <div
                      key={session.session_id}
                      className={cn(
                        'flex-shrink-0',
                        layout === 'vertical'
                          ? 'px-2 first:pt-2 last:pb-2'
                          : 'py-2 first:pl-2 first:mr-2 last:mr-2',
                        fullscreenSessionId === session.session_id &&
                          'contents',
                      )}
                      style={{
                        width:
                          fullscreenSessionId === session.session_id
                            ? undefined
                            : layout === 'vertical'
                              ? '100%'
                              : PIP_CARD_WIDTH[layout],
                      }}
                    >
                      <PipChatItem
                        session={session}
                        layout={layout}
                        isFullscreen={
                          fullscreenSessionId === session.session_id
                        }
                        isFocused={focusedChatId === session.session_id}
                        onFocus={() => setFocusedChatId(session.session_id)}
                        onToggleFullscreen={() =>
                          toggleFullscreen(session.session_id)
                        }
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
