import useSWR from 'swr'
import * as api from '../lib/api'
import { migrateKeymap, type Settings } from '../types'

async function fetchSettings(): Promise<Settings> {
  const settings = await api.getSettings()
  // Migrate old char-based key values (e.g. '[') to code-based names (e.g. 'bracketleft')
  if (settings.keymap) {
    settings.keymap = migrateKeymap(settings.keymap)
  }
  return settings
}

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<Settings>(
    '/api/settings',
    fetchSettings,
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
