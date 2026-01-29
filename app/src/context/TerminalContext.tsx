import { createContext, useContext, useEffect, useState } from 'react'
import { useTerminals } from '../hooks/useTerminals'
import type { Terminal } from '../types'

interface TerminalContextValue {
  terminals: Terminal[]
  loading: boolean
  activeTerminal: Terminal | null
  selectTerminal: (id: number) => void
  setTerminalOrder: (value: number[] | ((prev: number[]) => number[])) => void
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { terminals, loading, setTerminalOrder } = useTerminals()
  const [activeTerminalId, setActiveTerminalId] = useState<number | null>(null)

  // Auto-select first terminal when terminals load
  useEffect(() => {
    if (terminals.length > 0 && activeTerminalId === null) {
      setActiveTerminalId(terminals[0].id)
    }
  }, [terminals, activeTerminalId])

  // Clear active terminal if it was deleted
  useEffect(() => {
    if (activeTerminalId && !terminals.find((t) => t.id === activeTerminalId)) {
      setActiveTerminalId(terminals.length > 0 ? terminals[0].id : null)
    }
  }, [terminals, activeTerminalId])

  const activeTerminal =
    terminals.find((t) => t.id === activeTerminalId) ?? null

  return (
    <TerminalContext.Provider
      value={{
        terminals,
        loading,
        activeTerminal,
        selectTerminal: setActiveTerminalId,
        setTerminalOrder,
      }}
    >
      {children}
    </TerminalContext.Provider>
  )
}

export function useTerminalContext() {
  const context = useContext(TerminalContext)
  if (!context) {
    throw new Error('useTerminalContext must be used within TerminalProvider')
  }
  return context
}
