import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { Terminal } from '../types'

export function useTerminals() {
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTerminals = useCallback(async () => {
    try {
      setError(null)
      const data = await api.getTerminals()
      setTerminals(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch terminals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTerminals()
  }, [fetchTerminals])

  const createTerminal = useCallback(async (cwd: string, name?: string) => {
    const terminal = await api.createTerminal(cwd, name)
    setTerminals((prev) => [terminal, ...prev])
    return terminal
  }, [])

  const updateTerminal = useCallback(
    async (id: number, updates: { name?: string }) => {
      const updated = await api.updateTerminal(id, updates)
      setTerminals((prev) => prev.map((t) => (t.id === id ? updated : t)))
      return updated
    },
    [],
  )

  const deleteTerminal = useCallback(async (id: number) => {
    await api.deleteTerminal(id)
    setTerminals((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return {
    terminals,
    loading,
    error,
    createTerminal,
    updateTerminal,
    deleteTerminal,
    refetch: fetchTerminals,
  }
}
