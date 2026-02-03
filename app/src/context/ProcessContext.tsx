import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type {
  ActiveProcess,
  GitDirtyPayload,
  ProcessesPayload,
} from '../../shared/types'
import { useSocket } from '../hooks/useSocket'

interface ProcessContextValue {
  processes: ActiveProcess[]
  terminalPorts: Record<number, number[]>
  gitDirtyStatus: Record<
    number,
    { added: number; removed: number; untracked: number }
  >
}

const ProcessContext = createContext<ProcessContextValue | null>(null)

export function ProcessProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useSocket()

  const [processes, setProcesses] = useState<ActiveProcess[]>([])
  const [terminalPorts, setTerminalPorts] = useState<Record<number, number[]>>(
    {},
  )
  const [gitDirtyStatus, setGitDirtyStatus] = useState<
    Record<number, { added: number; removed: number; untracked: number }>
  >({})

  useEffect(() => {
    return subscribe<GitDirtyPayload>('git:dirty-status', (data) => {
      setGitDirtyStatus((prev) => {
        const next = data.dirtyStatus
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const key of nextKeys) {
          const p = prev[Number(key)]
          const n = next[Number(key)]
          if (
            !p ||
            !n ||
            p.added !== n.added ||
            p.removed !== n.removed ||
            p.untracked !== n.untracked
          )
            return next
        }
        return prev
      })
    })
  }, [subscribe])

  useEffect(() => {
    return subscribe<ProcessesPayload>('processes', (data) => {
      if (data.terminalId !== undefined) {
        setProcesses((prev) => [
          ...prev.filter((p) => p.terminalId !== data.terminalId),
          ...data.processes,
        ])
      } else {
        setProcesses(data.processes)
      }

      if (data.ports) {
        setTerminalPorts((prev) => {
          if (data.terminalId !== undefined) {
            const next = { ...prev }
            const ports = data.ports?.[data.terminalId]
            if (ports && ports.length > 0) {
              next[data.terminalId] = ports
            } else {
              delete next[data.terminalId]
            }
            return next
          }
          return data.ports ?? {}
        })
      }
    })
  }, [subscribe])

  const value = useMemo(
    () => ({ processes, terminalPorts, gitDirtyStatus }),
    [processes, terminalPorts, gitDirtyStatus],
  )

  return (
    <ProcessContext.Provider value={value}>{children}</ProcessContext.Provider>
  )
}

export function useProcessContext() {
  const context = useContext(ProcessContext)
  if (!context) {
    throw new Error('useProcessContext must be used within ProcessProvider')
  }
  return context
}
