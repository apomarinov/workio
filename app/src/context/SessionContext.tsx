import type { HookEvent, SessionWithProject } from '@domains/sessions/schema'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSocket } from '@/hooks/useSocket'
import { trpc } from '@/lib/trpc'

interface SessionUpdateEvent {
  session_id: string
  messages: unknown[]
}

interface SessionUpdatedEvent {
  sessionId: string
  data: Record<string, unknown>
}

interface SessionsDeletedEvent {
  session_ids: string[]
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
  const utils = trpc.useUtils()
  const { data, error, isLoading } = trpc.sessions.list.useQuery()

  const updateMutation = trpc.sessions.update.useMutation()
  const removeMutation = trpc.sessions.remove.useMutation()
  const bulkDeleteMutation = trpc.sessions.bulkDelete.useMutation()

  const setData = (
    updater: (
      prev: SessionWithProject[] | undefined,
    ) => SessionWithProject[] | undefined,
  ) => {
    utils.sessions.list.setData(undefined, updater)
  }

  const debounceMap = useRef(new Map<string, NodeJS.Timeout>())

  const selectSession = (id: string) => {
    setActiveSessionId(id)
  }

  const clearSession = () => {
    setActiveSessionId(null)
  }

  const mergeSession = async (sessionId: string) => {
    try {
      const updated = await utils.sessions.getById.fetch({ id: sessionId })
      setData((prev) => {
        if (!prev) return [updated]
        const idx = prev.findIndex((s) => s.session_id === sessionId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updated
          return next
        }
        return [updated, ...prev]
      })
    } catch {
      // Session may not exist yet (e.g. SessionStart before DB commit),
      // fall back to full refetch
      utils.sessions.list.invalidate()
    }
  }

  const debouncedMerge = (sessionId: string) => {
    const existing = debounceMap.current.get(sessionId)
    if (existing) clearTimeout(existing)
    debounceMap.current.set(
      sessionId,
      setTimeout(() => {
        debounceMap.current.delete(sessionId)
        mergeSession(sessionId)
      }, 1000),
    )
  }

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

  useEffect(() => {
    return subscribe<SessionUpdatedEvent>('session:updated', (event) => {
      setData((prev) => {
        if (!prev) return prev
        const idx = prev.findIndex((s) => s.session_id === event.sessionId)
        if (idx < 0) return prev
        const next = [...prev]
        const { status, ...rest } = event.data
        next[idx] = {
          ...next[idx],
          ...(status !== undefined
            ? {
                status: status as SessionWithProject['status'],
                updated_at: new Date().toISOString(),
              }
            : {}),
          data: { ...next[idx].data, ...rest },
        }
        next.sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        return next
      })
    })
  }, [subscribe])

  // Listen for refetch events from other clients
  useEffect(() => {
    return subscribe<{ group: string }>('refetch', ({ group }) => {
      if (group === 'sessions') utils.sessions.list.invalidate()
    })
  }, [subscribe])

  useEffect(() => {
    return subscribe<SessionsDeletedEvent>('sessions_deleted', (data) => {
      const deletedSet = new Set(data.session_ids)
      setData((prev) => prev?.filter((s) => !deletedSet.has(s.session_id)))
      setActiveSessionId((prev) => (prev && deletedSet.has(prev) ? null : prev))
    })
  }, [subscribe])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timeout of debounceMap.current.values()) {
        clearTimeout(timeout)
      }
    }
  }, [])

  const updateSession = async (
    sessionId: string,
    updates: { name?: string },
  ) => {
    await updateMutation.mutateAsync({ id: sessionId, name: updates.name })
    setData((prev) =>
      prev?.map((s) => (s.session_id === sessionId ? { ...s, ...updates } : s)),
    )
  }

  const deleteSession = async (sessionId: string) => {
    await removeMutation.mutateAsync({ id: sessionId })
    if (sessionId === activeSessionId) {
      clearSession()
    }
    setData((prev) => prev?.filter((s) => s.session_id !== sessionId))
  }

  const deleteSessions = async (ids: string[]) => {
    await bulkDeleteMutation.mutateAsync({ ids })
    if (activeSessionId && ids.includes(activeSessionId)) {
      clearSession()
    }
    const deletedSet = new Set(ids)
    setData((prev) => prev?.filter((s) => !deletedSet.has(s.session_id)))
  }

  const sessions = data ?? []
  const errorMessage = error?.message ?? null

  const refetch = () => {
    utils.sessions.list.invalidate()
  }

  const value: SessionContextValue = {
    activeSessionId,
    selectSession,
    clearSession,
    sessions,
    loading: isLoading,
    error: errorMessage,
    refetch,
    updateSession,
    deleteSession,
    deleteSessions,
  }

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
