import useSWR from 'swr'
import * as api from '../lib/api'
import type { SessionWithProject } from '../types'

export function useClaudeSessions() {
  const { data, error, isLoading, mutate } = useSWR<SessionWithProject[]>(
    '/api/sessions',
    api.getClaudeSessions,
  )

  return {
    sessions: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    refetch: mutate,
  }
}
