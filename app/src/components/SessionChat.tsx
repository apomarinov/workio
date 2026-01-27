import { Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useSessionContext } from '../context/SessionContext'
import { useClaudeSessions } from '../hooks/useClaudeSessions'
import { useSessionMessages } from '../hooks/useSessionMessages'
import type { SessionMessage } from '../types'
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
  const { activeSessionId, clearSession } = useSessionContext()
  const { sessions } = useClaudeSessions()
  const { messages, loading, isLoadingMore, hasMore, loadMore } =
    useSessionMessages(activeSessionId)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef<number>(0)
  const isInitialLoadRef = useRef(true)

  const session = sessions.find((s) => s.session_id === activeSessionId)

  const groupedMessages = useMemo(() => groupMessages(messages), [messages])

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
  }, [activeSessionId])

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
      }
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
              <p className="text-xs text-zinc-500 truncate">
                {session.project_path}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearSession}
            className="flex-shrink-0 text-zinc-400 hover:text-zinc-100"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages */}
        <div
          ref={scrollContainerRef}
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
