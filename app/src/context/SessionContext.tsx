import { createContext, useContext, useState } from 'react'

interface SessionContextValue {
  activeSessionId: string | null
  selectSession: (id: string) => void
  clearSession: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const selectSession = (id: string) => {
    setActiveSessionId(id)
  }

  const clearSession = () => {
    setActiveSessionId(null)
  }

  return (
    <SessionContext.Provider
      value={{
        activeSessionId,
        selectSession,
        clearSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSessionContext() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSessionContext must be used within SessionProvider')
  }
  return context
}
