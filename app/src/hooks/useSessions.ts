import { useState, useEffect, useCallback } from 'react'
import type { TerminalSession } from '../types'
import * as api from '../lib/api'

export function useSessions() {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      setError(null)
      const data = await api.getSessions()
      setSessions(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const createSession = useCallback(async (cwd: string, name?: string) => {
    const session = await api.createSession(cwd, name)
    setSessions(prev => [session, ...prev])
    return session
  }, [])

  const updateSession = useCallback(async (id: number, updates: { name?: string }) => {
    const updated = await api.updateSession(id, updates)
    setSessions(prev => prev.map(s => s.id === id ? updated : s))
    return updated
  }, [])

  const deleteSession = useCallback(async (id: number) => {
    await api.deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }, [])

  return {
    sessions,
    loading,
    error,
    createSession,
    updateSession,
    deleteSession,
    refetch: fetchSessions,
  }
}
