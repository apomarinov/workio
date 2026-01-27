import { useCallback, useEffect, useMemo, useState } from 'react'
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

        setAllMessages((prev) => {
          const result = [...prev]

          for (const msg of data.messages) {
            // For todo messages, find by todo_id and replace
            if (msg.todo_id) {
              const existingIdx = result.findIndex(
                (m) => m.todo_id === msg.todo_id,
              )
              if (existingIdx !== -1) {
                // Replace existing todo message
                result[existingIdx] = msg
                continue
              }
            }

            // For other messages, check by id
            const existsById = result.some((m) => m.id === msg.id)
            if (!existsById) {
              // Prepend new message (newest first in array)
              result.unshift(msg)
            }
          }

          return result
        })
      },
    )
  }, [subscribe, sessionId])

  // Load more messages (older messages)
  const loadMore = useCallback(async () => {
    if (!sessionId || isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      const result = await api.getSessionMessages(sessionId, PAGE_SIZE, offset)
      setAllMessages((prev) => {
        // Deduplicate - only add messages not already in the list
        const existingIds = new Set(prev.map((m) => m.id))
        const newMessages = result.messages.filter(
          (m) => !existingIds.has(m.id),
        )
        return [...prev, ...newMessages]
      })
      setOffset((prev) => prev + result.messages.length)
      setHasMore(result.hasMore)
    } finally {
      setIsLoadingMore(false)
    }
  }, [sessionId, offset, isLoadingMore, hasMore])

  // Reverse messages for display (newest first in API, oldest first in UI)
  // Also deduplicate to prevent React key errors
  const displayMessages = useMemo(() => {
    const seen = new Set<number>()
    const deduped: SessionMessage[] = []
    for (const msg of allMessages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id)
        deduped.push(msg)
      }
    }
    return deduped.reverse()
  }, [allMessages])

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
