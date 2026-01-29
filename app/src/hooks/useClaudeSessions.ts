import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import type { HookEvent, SessionWithProject } from '../types'
import { useSocket } from './useSocket'

export function useClaudeSessions() {
  const { subscribe } = useSocket()
  const { data, error, isLoading, mutate } = useSWR<SessionWithProject[]>(
    '/api/sessions',
    api.getClaudeSessions,
  )

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return subscribe<HookEvent>('hook', (data) => {
      if (data.hook_type === 'UserPromptSubmit') {
        mutate()
        return
      }
      // Debounce refetch
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        mutate()
      }, 1000)
    })
  }, [subscribe, mutate])

  useEffect(() => {
    return subscribe('session_update', () => {
      mutate()
    })
  }, [subscribe, mutate])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
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
