import { useCallback } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import type { SessionWithProject } from '../types'

export function useClaudeSessions() {
  const { data, error, isLoading, mutate } = useSWR<SessionWithProject[]>(
    '/api/sessions',
    api.getClaudeSessions,
  )

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
