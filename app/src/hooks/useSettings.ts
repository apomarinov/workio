import { useEffect } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import { migrateKeymap, type Settings } from '../types'
import { useSocket } from './useSocket'

async function fetchSettings(): Promise<Settings> {
  const settings = await api.getSettings()
  // Migrate old char-based key values (e.g. '[') to code-based names (e.g. 'bracketleft')
  if (settings.keymap) {
    settings.keymap = migrateKeymap(settings.keymap)
  }
  return settings
}

export function useSettings() {
  const { subscribe } = useSocket()
  const { data, error, isLoading, mutate } = useSWR<Settings>(
    '/api/settings',
    fetchSettings,
    { refreshInterval: 5 * 60 * 1000 }, // Refresh every 5 minutes
  )

  // Listen for refetch events from other clients
  useEffect(() => {
    return subscribe<{ group: string }>('refetch', ({ group }) => {
      if (group === 'settings') mutate()
    })
  }, [subscribe, mutate])

  const updateSettings = async (updates: Partial<Omit<Settings, 'id'>>) => {
    const optimistic = data ? { ...data, ...updates } : undefined
    if (optimistic) mutate(optimistic, false)
    try {
      const updated = await api.updateSettings(updates)
      mutate(updated, false)
      return updated
    } catch (err) {
      // Revert optimistic update on failure
      if (data) mutate(data, false)
      throw err
    }
  }

  return {
    settings: data,
    loading: isLoading,
    error: error?.message ?? null,
    updateSettings,
    refetch: mutate,
  }
}
