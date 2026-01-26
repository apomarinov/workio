import useSWR from 'swr'
import * as api from '../lib/api'
import type { Terminal } from '../types'

export function useTerminals() {
  const { data, error, isLoading, mutate } = useSWR<Terminal[]>(
    '/api/terminals',
    api.getTerminals,
  )

  const createTerminal = async (cwd: string, name?: string, shell?: string) => {
    const terminal = await api.createTerminal(cwd, name, shell)
    mutate((prev) => (prev ? [terminal, ...prev] : [terminal]), false)
    return terminal
  }

  const updateTerminal = async (id: number, updates: { name?: string }) => {
    const updated = await api.updateTerminal(id, updates)
    mutate((prev) => prev?.map((t) => (t.id === id ? updated : t)), false)
    return updated
  }

  const deleteTerminal = async (id: number) => {
    await api.deleteTerminal(id)
    mutate((prev) => prev?.filter((t) => t.id !== id), false)
  }

  return {
    terminals: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    createTerminal,
    updateTerminal,
    deleteTerminal,
    refetch: mutate,
  }
}
