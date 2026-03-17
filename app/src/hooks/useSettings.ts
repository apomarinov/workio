import { useEffect } from 'react'
import type { SettingsUpdate } from 'server/domains/settings/schema'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { useSocket } from './useSocket'

export function useSettings() {
  const { subscribe } = useSocket()
  const utils = trpc.useUtils()
  const { data, error, isLoading, refetch } = trpc.settings.get.useQuery()

  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
    onError: (err) => toastError(err, 'Failed to update settings'),
  })

  // Listen for refetch events from other clients
  useEffect(() => {
    return subscribe<{ group: string }>('refetch', ({ group }) => {
      if (group === 'settings') refetch()
    })
  }, [subscribe, refetch])

  const updateSettings = async (updates: SettingsUpdate) => {
    return updateMutation.mutateAsync(updates)
  }

  return {
    settings: data,
    loading: isLoading || updateMutation.isPending,
    error: error?.message ?? null,
    updateSettings,
    refetch,
  }
}
