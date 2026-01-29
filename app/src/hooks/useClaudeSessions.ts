import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import type { HookEvent, SessionWithProject } from '../types'
import { useSocket } from './useSocket'

interface SessionUpdateEvent {
  session_id: string
  messages: unknown[]
}

export function useClaudeSessions() {
  const { subscribe } = useSocket()
  const { data, error, isLoading, mutate } = useSWR<SessionWithProject[]>(
    '/api/sessions',
    api.getClaudeSessions,
  )

  const debounceMap = useRef(new Map<string, NodeJS.Timeout>())

  const mergeSession = useCallback(
    async (sessionId: string) => {
      try {
        const updated = await api.getClaudeSession(sessionId)
        mutate(
          (prev) => {
            if (!prev) return [updated]
            const idx = prev.findIndex((s) => s.session_id === sessionId)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = updated
              return next
            }
            return [updated, ...prev]
          },
          { revalidate: false },
        )
      } catch {
        // Session may not exist yet (e.g. SessionStart before DB commit),
        // fall back to full refetch
        mutate()
      }
    },
    [mutate],
  )

  const debouncedMerge = useCallback(
    (sessionId: string) => {
      const existing = debounceMap.current.get(sessionId)
      if (existing) clearTimeout(existing)
      debounceMap.current.set(
        sessionId,
        setTimeout(() => {
          debounceMap.current.delete(sessionId)
          mergeSession(sessionId)
        }, 1000),
      )
    },
    [mergeSession],
  )

  useEffect(() => {
    return subscribe<HookEvent>('hook', (data) => {
      if (data.hook_type === 'UserPromptSubmit') {
        mergeSession(data.session_id)
        return
      }
      debouncedMerge(data.session_id)
    })
  }, [subscribe, mergeSession, debouncedMerge])

  useEffect(() => {
    return subscribe<SessionUpdateEvent>('session_update', (data) => {
      debouncedMerge(data.session_id)
    })
  }, [subscribe, debouncedMerge])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timeout of debounceMap.current.values()) {
        clearTimeout(timeout)
      }
    }
  }, [])

  const updateSession = useCallback(
    async (sessionId: string, updates: { name?: string }) => {
      await api.updateSession(sessionId, updates)
      mutate()
    },
    [mutate],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await api.deleteSession(sessionId)
      mutate()
    },
    [mutate],
  )

  const deleteSessions = useCallback(
    async (ids: string[]) => {
      await api.deleteSessions(ids)
      mutate()
    },
    [mutate],
  )

  return {
    sessions: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    refetch: mutate,
    updateSession,
    deleteSession,
    deleteSessions,
  }
}
