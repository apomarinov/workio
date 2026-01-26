import useSWR from 'swr'
import * as api from '../lib/api'
import type { Settings } from '../types'

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<Settings>(
    '/api/settings',
    api.getSettings,
  )

  const updateSettings = async (settings: Partial<Settings>) => {
    const updated = await api.updateSettings(settings)
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
