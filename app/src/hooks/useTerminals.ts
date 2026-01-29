import { useMemo } from 'react'
import useSWR from 'swr'
import * as api from '../lib/api'
import type { Terminal } from '../types'
import { useLocalStorage } from './useLocalStorage'

export function useTerminals() {
  const { data, error, isLoading, mutate } = useSWR<Terminal[]>(
    '/api/terminals',
    api.getTerminals,
  )

  const [terminalOrder, setTerminalOrder] = useLocalStorage<number[]>(
    'sidebar-terminal-order',
    [],
  )

  const raw = data ?? []

  const terminals = useMemo(() => {
    if (terminalOrder.length === 0) return raw
    const terminalMap = new Map(raw.map((t) => [t.id, t]))
    const ordered: Terminal[] = []
    for (const id of terminalOrder) {
      const t = terminalMap.get(id)
      if (t) {
        ordered.push(t)
        terminalMap.delete(id)
      }
    }
    // Append any new terminals not yet in the order (newest first, matching default)
    for (const t of raw) {
      if (terminalMap.has(t.id)) {
        ordered.push(t)
      }
    }
    return ordered
  }, [raw, terminalOrder])

  const createTerminal = async (
    cwd: string,
    name?: string,
    shell?: string,
    ssh_host?: string,
  ) => {
    const terminal = await api.createTerminal(cwd, name, shell, ssh_host)
    mutate((prev) => (prev ? [terminal, ...prev] : [terminal]), false)
    return terminal
  }

  const updateTerminal = async (
    id: number,
    updates: { name?: string; cwd?: string },
  ) => {
    const updated = await api.updateTerminal(id, updates)
    mutate((prev) => prev?.map((t) => (t.id === id ? updated : t)), false)
    return updated
  }

  const deleteTerminal = async (id: number) => {
    await api.deleteTerminal(id)
    mutate((prev) => prev?.filter((t) => t.id !== id), false)
  }

  return {
    terminals,
    loading: isLoading,
    error: error?.message ?? null,
    createTerminal,
    updateTerminal,
    deleteTerminal,
    setTerminalOrder,
    refetch: mutate,
  }
}
