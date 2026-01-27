import { Folder, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSessionContext } from '../context/SessionContext'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import { useSessionMessages } from '../hooks/useSessionMessages'
import { useSettings } from '../hooks/useSettings'
import type { SessionMessage, TodoWriteTool } from '../types'
import { MessageBubble, ThinkingGroup } from './MessageBubble'

type GroupedMessage =
  | { type: 'message'; message: SessionMessage }
  | { type: 'thinking'; messages: SessionMessage[] }

function groupMessages(messages: SessionMessage[]): GroupedMessage[] {
  const result: GroupedMessage[] = []
  let currentThinkingGroup: SessionMessage[] = []

  for (const message of messages) {
    if (message.thinking) {
      currentThinkingGroup.push(message)
    } else {
      if (currentThinkingGroup.length > 0) {
        result.push({ type: 'thinking', messages: currentThinkingGroup })
        currentThinkingGroup = []
      }
      result.push({ type: 'message', message })
    }
  }

  if (currentThinkingGroup.length > 0) {
    result.push({ type: 'thinking', messages: currentThinkingGroup })
  }

  return result
}

export function SessionChat() {
  const { activeSessionId } = useSessionContext()
  const { sessions } = useClaudeSessions()
  const { settings } = useSettings()
  const { messages, loading, isLoadingMore, hasMore, loadMore } =
    useSessionMessages(activeSessionId)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef<number>(0)
  const prevMessageCountRef = useRef<number>(0)
  const isInitialLoadRef = useRef(true)
  const isNearBottomRef = useRef(true)

  const session = sessions.find((s) => s.session_id === activeSessionId)

  // Filter and reorder messages
  const filteredMessages = useMemo(() => {
    let result = messages

    // Filter out tool messages if show_tools is disabled, but keep todos
    if (settings?.show_tools === false) {
      result = result.filter((m) => !m.tools || m.todo_id)
    }

    // Find message with incomplete todos and move to end (shows first in chat)
    const hasIncompleteTodos = (m: SessionMessage) => {
      if (m.tools?.name !== 'TodoWrite') return false
      const tool = m.tools as TodoWriteTool
      return tool.input.todos?.some((t) => t.status !== 'completed')
    }

    const incompleteTodoMsg = result.find(hasIncompleteTodos)
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
        // Save scroll height before loading more
        if (scrollContainerRef.current) {
          prevScrollHeightRef.current = scrollContainerRef.current.scrollHeight
        }
        loadMore()
      }
    },
    [hasMore, isLoadingMore, loading, loadMore],
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(handleIntersection, {
      threshold: 0.1,
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleIntersection])

  // Reset initial load flag when session changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on session change
  useEffect(() => {
    isInitialLoadRef.current = true
    isNearBottomRef.current = true
  }, [activeSessionId])

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
      } else if (prevScrollHeightRef.current > 0) {
        // Preserve scroll position when loading more at top
        const newScrollHeight = scrollContainerRef.current.scrollHeight
        const scrollDiff = newScrollHeight - prevScrollHeightRef.current
        scrollContainerRef.current.scrollTop += scrollDiff
        prevScrollHeightRef.current = 0
      } else if (
        messages.length > prevMessageCountRef.current &&
        isNearBottomRef.current
      ) {
        // Auto-scroll to bottom for new messages if user is near bottom
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight
      }
      prevMessageCountRef.current = messages.length
    }
  }, [loading, messages.length])

  if (!activeSessionId) {
    return null
  }

  return (
    <div className="relative h-full">
      <div className="absolute inset-0 flex flex-col bg-sidebar">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 w-full">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-zinc-100 truncate">
              {session?.name || 'Session Chat'}
            </h2>
            {session?.project_path && (
              <div className="flex gap-1 items-center">
                <Folder className="w-3 h-3" />
                <p className="text-xs text-zinc-500 truncate">
                  {session.project_path}
                </p>
              </div>
            )}
          </div>
        </div>

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
                  <MessageBubble key={item.message.id} message={item.message} />
                ),
              )}
              {session && ['active', 'permission_needed'].includes(session.status) && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 300 150"
                  className="w-8 h-8"
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
          )}
        </div>
      </div>
    </div>
  )
}
