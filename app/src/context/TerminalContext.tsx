import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSocket } from '../hooks/useSocket'
import * as api from '../lib/api'
import type { Terminal } from '../types'

interface TerminalContextValue {
  terminals: Terminal[]
  loading: boolean
  activeTerminal: Terminal | null
  selectTerminal: (id: number) => void
  createTerminal: (
    cwd: string,
    name?: string,
    shell?: string,
    ssh_host?: string,
  ) => Promise<Terminal>
  updateTerminal: (
    id: number,
    updates: { name?: string; cwd?: string },
  ) => Promise<Terminal>
  deleteTerminal: (id: number) => Promise<void>
  setTerminalOrder: (value: number[] | ((prev: number[]) => number[])) => void
  refetch: () => void
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useSocket()
  const { data, isLoading, mutate } = useSWR<Terminal[]>(
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
    for (const t of raw) {
      if (terminalMap.has(t.id)) {
        ordered.push(t)
      }
    }
    return ordered
  }, [raw, terminalOrder])

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

  // Refetch terminals when server emits an update
  useEffect(() => {
    return subscribe('terminal:updated', () => {
      mutate()
    })
  }, [subscribe, mutate])

  const activeTerminal =
    terminals.find((t) => t.id === activeTerminalId) ?? null

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

  return (
    <TerminalContext.Provider
      value={{
        terminals,
        loading: isLoading,
        activeTerminal,
        selectTerminal: setActiveTerminalId,
        createTerminal,
        updateTerminal,
        deleteTerminal,
        setTerminalOrder,
        refetch: () => mutate(),
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
