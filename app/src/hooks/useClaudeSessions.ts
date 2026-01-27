import { useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import type { SessionWithProject } from '../types'
import { useSocket } from './useSocket'

export function useClaudeSessions() {
  const { subscribe } = useSocket()
  const { data, error, isLoading, mutate } = useSWR<SessionWithProject[]>(
    '/api/sessions',
    api.getClaudeSessions,
  )

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return subscribe('session_update', () => {
      // Debounce refetch
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        mutate()
      }, 1000)
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

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await api.deleteSession(sessionId)
      mutate()
    },
    [mutate],
  )

  return {
    sessions: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    refetch: mutate,
    deleteSession,
  }
}
