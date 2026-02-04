import useSWR from 'swr'
import * as api from '../lib/api'
import type { Settings } from '../types'

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<Settings>(
    '/api/settings',
    api.getSettings,
    { refreshInterval: 5 * 60 * 1000 }, // Refresh every 5 minutes
  )

  const updateSettings = async (updates: Partial<Omit<Settings, 'id'>>) => {
    const updated = await api.updateSettings(updates)
    mutate(updated, false)
    return updated
  }

  return {
    settings: data,
    loading: isLoading,
    error: error?.message ?? null,
    updateSettings,
    refetch: mutate,
  }
}
