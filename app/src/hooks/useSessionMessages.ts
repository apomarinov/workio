import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import type { SessionMessage, SessionMessagesResponse } from '../types'
import { useSocket } from './useSocket'

const PAGE_SIZE = 30

export function useSessionMessages(sessionId: string | null) {
  const { subscribe } = useSocket()
  const [allMessages, setAllMessages] = useState<SessionMessage[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Fetch initial page of messages
  // Use dedupingInterval to prevent duplicate requests from StrictMode double-renders
  const { data, error, isLoading, mutate } = useSWR<SessionMessagesResponse>(
    sessionId ? `/api/sessions/${sessionId}/messages` : null,
    () => api.getSessionMessages(sessionId!, PAGE_SIZE, 0),
    {
      dedupingInterval: 2000,
      revalidateOnFocus: false,
    },
  )

  // Reset state when session changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is intentionally in deps to reset state on session change
  useEffect(() => {
    setAllMessages([])
    setOffset(0)
    setHasMore(true)
  }, [sessionId])

  // Update all messages when initial data loads
  useEffect(() => {
    if (data) {
      setAllMessages(data.messages)
      setHasMore(data.hasMore)
      setOffset(data.messages.length)
    }
  }, [data])

  // Subscribe to real-time updates via session_update event
  useEffect(() => {
    if (!sessionId) return

    return subscribe(
      'session_update',
      (data: { session_id: string; messages: SessionMessage[] }) => {
        if (data.session_id !== sessionId) return
        if (!data.messages || data.messages.length === 0) return

        // Prepend new messages (they're newest, allMessages is newest-first)
        setAllMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id))
          const newMessages = data.messages.filter(
            (m) => !existingIds.has(m.id),
          )
          return [...newMessages, ...prev]
        })
        setOffset((prev) => prev + data.messages.length)
      },
    )
  }, [subscribe, sessionId])

  // Load more messages (older messages)
  const loadMore = useCallback(async () => {
    if (!sessionId || isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      const result = await api.getSessionMessages(sessionId, PAGE_SIZE, offset)
      setAllMessages((prev) => [...prev, ...result.messages])
      setOffset((prev) => prev + result.messages.length)
      setHasMore(result.hasMore)
    } finally {
      setIsLoadingMore(false)
    }
  }, [sessionId, offset, isLoadingMore, hasMore])

  // Reverse messages for display (newest first in API, oldest first in UI)
  const displayMessages = [...allMessages].reverse()

  return {
    messages: displayMessages,
    loading: isLoading,
    isLoadingMore,
    hasMore,
    error: error?.message ?? null,
    loadMore,
    refetch: mutate,
  }
}
