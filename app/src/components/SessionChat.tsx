import { Folder, Loader2, MoreVertical } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { SessionStatusIcon } from '@/components/icons'
import { useSessionContext } from '@/context/SessionContext'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import { useSettings } from '@/hooks/useSettings'
import { groupMessages } from '@/lib/messageUtils'
import type { SessionMessage, TodoWriteTool } from '@/types'
import { MessageBubble, ThinkingGroup } from './MessageBubble'
import { Button } from './ui/button'

export function SessionChat({
  sessionId: sessionIdProp,
  hideHeader,
  hideAvatars,
  isMaximizedInPip,
  scrollToMessageId,
  loadAll,
}: {
  sessionId?: string | null
  hideHeader?: boolean
  hideAvatars?: boolean
  isMaximizedInPip?: boolean
  scrollToMessageId?: number | null
  loadAll?: boolean
} = {}) {
  const { activeSessionId, sessions } = useSessionContext()
  const resolvedSessionId = sessionIdProp ?? activeSessionId
  const { settings } = useSettings()
  const { messages, loading, isLoadingMore, hasMore, loadMore } =
    useSessionMessages(resolvedSessionId, { loadAll })

  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevMessageCountRef = useRef<number>(0)
  const isInitialLoadRef = useRef(true)
  const isNearBottomRef = useRef(true)

  const session = sessions.find((s) => s.session_id === resolvedSessionId)

  // Filter and reorder messages
  const filteredMessages = useMemo(() => {
    let result = messages

    // Filter out tool messages if show_tools is disabled, but keep todos
    if (settings?.show_tools === false) {
      result = result.filter((m) => !m.tools || m.todo_id)
    }

    // Find message with incomplete todos and move to end (shows first in chat)
    // Only if updated within last 5 minutes
    const hasRecentIncompleteTodos = (m: SessionMessage) => {
      if (m.tools?.name !== 'TodoWrite') return false
      const tool = m.tools as TodoWriteTool
      const hasIncomplete = tool.input.todos?.some(
        (t) => t.status !== 'completed',
      )
      if (!hasIncomplete) return false

      // Check if updated within last 5 minutes
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

  // Set up IntersectionObserver for infinite scroll
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore && !loading) {
        loadMore()
      }
    },
    [hasMore, isLoadingMore, loading, loadMore],
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !scrollContainerRef.current) return

    const observer = new IntersectionObserver(handleIntersection, {
      root: scrollContainerRef.current,
      rootMargin: `${window.innerHeight * 0.6}px`,
      threshold: 0,
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleIntersection])

  // Reset initial load flag when session changes

  useEffect(() => {
    isInitialLoadRef.current = true
    isNearBottomRef.current = true
  }, [resolvedSessionId])

  // Track if user is near bottom of scroll container
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const threshold = 100
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    isNearBottomRef.current = distanceFromBottom < threshold
  }, [])

  // Handle scroll position
  useEffect(() => {
    if (!loading && messages.length > 0 && scrollContainerRef.current) {
      if (isInitialLoadRef.current) {
        // Scroll to bottom on initial load
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight
        isInitialLoadRef.current = false
      } else if (
        messages.length > prevMessageCountRef.current &&
        (isMaximizedInPip === false || isNearBottomRef.current)
      ) {
        // Auto-scroll to bottom for new messages if user is near bottom
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight
      }
      prevMessageCountRef.current = messages.length
    }
  }, [loading, messages.length, isMaximizedInPip])

  // Scroll to a specific message (used by search panel)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHighlightedRef = useRef<number | null>(null)
  const highlightedElRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!scrollToMessageId || loading || messages.length === 0) return
    // Only highlight when the target actually changes
    if (lastHighlightedRef.current === scrollToMessageId) return
    lastHighlightedRef.current = scrollToMessageId

    const container = scrollContainerRef.current
    if (!container) return

    const highlightClasses = ['ring-2', 'ring-amber-400/60']

    // Clear previous highlight immediately
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    if (highlightedElRef.current) {
      highlightedElRef.current.classList.remove(...highlightClasses)
      highlightedElRef.current = null
    }

    // Wait for render
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector(
        `[data-message-id="${scrollToMessageId}"]`,
      ) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const bubble = (el.querySelector('[data-message-bubble]') ??
        el) as HTMLElement
      bubble.classList.add(...highlightClasses)
      highlightedElRef.current = bubble
      highlightTimerRef.current = setTimeout(() => {
        bubble.classList.remove(...highlightClasses)
        highlightedElRef.current = null
      }, 2000)
    })
    return () => cancelAnimationFrame(raf)
  }, [scrollToMessageId, loading, messages.length])

  if (!resolvedSessionId) {
    return null
  }

  return (
    <div className="relative h-full">
      <div className="absolute inset-0 flex flex-col bg-sidebar">
        {/* Header */}
        {!hideHeader && (
          <div className="flex items-center justify-between gap-2 px-4 py-1.5 border-b border-sidebar-border w-full">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-medium text-zinc-100 truncate">
                {session?.name || 'Untitled'}
              </h2>
              {session?.project_path && (
                <div className="flex gap-1 items-center">
                  <Folder className="w-3 h-3 text-zinc-500" />
                  <p className="text-xs text-zinc-500 truncate">
                    {session.project_path}
                  </p>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('open-item-actions', {
                    detail: { terminalId: null, sessionId: resolvedSessionId },
                  }),
                )
              }}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4"
        >
          {/* Sentinel for infinite scroll (at top for loading older messages) */}
          <div ref={sentinelRef} className="h-1" />

          {/* Loading more indicator */}
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
            </div>
          )}

          {/* Initial loading state */}
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
              No messages in this session
            </div>
          ) : (
            <div className="space-y-3">
              {groupedMessages.map((item) =>
                item.type === 'thinking' ? (
                  <ThinkingGroup
                    key={`thinking-${item.messages[0].id}`}
                    messages={item.messages}
                  />
                ) : (
                  <MessageBubble
                    key={item.message.id}
                    message={item.message}
                    hideAvatars={hideAvatars}
                  />
                ),
              )}
              {session &&
                ['active', 'permission_needed'].includes(session.status) && (
                  <div className="flex gap-2 items-center">
                    <SessionStatusIcon
                      status={session.status}
                      className="w-8 h-8"
                    />
                    {session.status === 'permission_needed' && (
                      <span>Permission Requested</span>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
