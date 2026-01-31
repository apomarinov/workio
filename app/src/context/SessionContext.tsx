import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import useSWR from 'swr'
import { useSocket } from '../hooks/useSocket'
import * as api from '../lib/api'
import type { HookEvent, SessionWithProject } from '../types'

interface SessionUpdateEvent {
  session_id: string
  messages: unknown[]
}

interface SessionContextValue {
  activeSessionId: string | null
  selectSession: (id: string) => void
  clearSession: () => void
  sessions: SessionWithProject[]
  loading: boolean
  error: string | null
  refetch: () => void
  updateSession: (
    sessionId: string,
    updates: { name?: string },
  ) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  deleteSessions: (ids: string[]) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const { subscribe } = useSocket()
  const { data, error, isLoading, mutate } = useSWR<SessionWithProject[]>(
    '/api/sessions',
    api.getClaudeSessions,
  )

  const debounceMap = useRef(new Map<string, NodeJS.Timeout>())

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const clearSession = useCallback(() => {
    setActiveSessionId(null)
  }, [])

  const mergeSession = useCallback(
    async (sessionId: string) => {
      try {
        const updated = await api.getClaudeSession(sessionId)
        mutate(
          (prev) => {
            if (!prev) return [updated]
            const idx = prev.findIndex((s) => s.session_id === sessionId)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = updated
              return next
            }
            return [updated, ...prev]
          },
          { revalidate: false },
        )
      } catch {
        // Session may not exist yet (e.g. SessionStart before DB commit),
        // fall back to full refetch
        mutate()
      }
    },
    [mutate],
  )

  const debouncedMerge = useCallback(
    (sessionId: string) => {
      const existing = debounceMap.current.get(sessionId)
      if (existing) clearTimeout(existing)
      debounceMap.current.set(
        sessionId,
        setTimeout(() => {
          debounceMap.current.delete(sessionId)
          mergeSession(sessionId)
        }, 1000),
      )
    },
    [mergeSession],
  )

  useEffect(() => {
    return subscribe<HookEvent>('hook', (data) => {
      if (data.hook_type === 'UserPromptSubmit') {
        mergeSession(data.session_id)
        return
      }
      debouncedMerge(data.session_id)
    })
  }, [subscribe, mergeSession, debouncedMerge])

  useEffect(() => {
    return subscribe<SessionUpdateEvent>('session_update', (data) => {
      debouncedMerge(data.session_id)
    })
  }, [subscribe, debouncedMerge])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timeout of debounceMap.current.values()) {
        clearTimeout(timeout)
      }
    }
  }, [])

  const updateSession = useCallback(
    async (sessionId: string, updates: { name?: string }) => {
      await api.updateSession(sessionId, updates)
      mutate()
    },
    [mutate],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await api.deleteSession(sessionId)
      if (sessionId === activeSessionId) {
        clearSession()
      }
      mutate()
    },
    [mutate, activeSessionId, clearSession],
  )

  const deleteSessions = useCallback(
    async (ids: string[]) => {
      await api.deleteSessions(ids)
      if (activeSessionId && ids.includes(activeSessionId)) {
        clearSession()
      }
      mutate()
    },
    [mutate, activeSessionId, clearSession],
  )

  const sessions = useMemo(() => data ?? [], [data])
  const errorMessage = useMemo(() => error?.message ?? null, [error])

  const value = useMemo(
    () => ({
      activeSessionId,
      selectSession,
      clearSession,
      sessions,
      loading: isLoading,
      error: errorMessage,
      refetch: mutate,
      updateSession,
      deleteSession,
      deleteSessions,
    }),
    [
      activeSessionId,
      selectSession,
      clearSession,
      sessions,
      isLoading,
      errorMessage,
      mutate,
      updateSession,
      deleteSession,
      deleteSessions,
    ],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSessionContext() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSessionContext must be used within SessionProvider')
  }
  return context
}
