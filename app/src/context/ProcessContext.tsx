import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  ActiveProcess,
  GitDirtyPayload,
  GitRemoteSyncPayload,
  ProcessesPayload,
} from '../../shared/types'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSocket } from '../hooks/useSocket'
import { useNotifications } from './NotificationContext'

interface Subscription {
  terminalId: number
  pid: number
  command: string
  terminalName: string
}

type Subscriptions = Record<string, Subscription>

interface ProcessContextValue {
  processes: ActiveProcess[]
  terminalPorts: Record<number, number[]>
  gitDirtyStatus: Record<
    number,
    { added: number; removed: number; untracked: number }
  >
  gitRemoteSyncStatus: Record<
    number,
    { behind: number; ahead: number; noRemote: boolean }
  >
  subscribeToBell: (process: ActiveProcess, terminalName: string) => void
  unsubscribeFromBell: (terminalId: number, pid: number) => void
  isBellSubscribed: (terminalId: number, pid: number) => boolean
}

const ProcessContext = createContext<ProcessContextValue | null>(null)

export function ProcessProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useSocket()
  const { sendNotification } = useNotifications()

  const [processes, setProcesses] = useState<ActiveProcess[]>([])
  const [terminalPorts, setTerminalPorts] = useState<Record<number, number[]>>(
    {},
  )
  const [gitDirtyStatus, setGitDirtyStatus] = useState<
    Record<number, { added: number; removed: number; untracked: number }>
  >({})
  const [gitRemoteSyncStatus, setGitRemoteSyncStatus] = useState<
    Record<number, { behind: number; ahead: number; noRemote: boolean }>
  >({})

  // Bell subscriptions
  const [subscriptions, setSubscriptions] = useLocalStorage<Subscriptions>(
    'process-subscriptions',
    {},
  )
  const prevKeysRef = useRef<Set<string> | null>(null)
  const staleCountRef = useRef<Record<string, number>>({})

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
    return subscribe<GitRemoteSyncPayload>('git:remote-sync', (data) => {
      setGitRemoteSyncStatus((prev) => {
        const next = data.syncStatus
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const key of nextKeys) {
          const p = prev[Number(key)]
          const n = next[Number(key)]
          if (
            !p ||
            !n ||
            p.behind !== n.behind ||
            p.ahead !== n.ahead ||
            p.noRemote !== n.noRemote
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

  // Bell subscription: detect process removal and fire notifications
  useEffect(() => {
    const currentKeys = new Set(
      processes
        .filter((p) => p.pid > 0 && p.terminalId !== undefined)
        .map((p) => `${p.terminalId}:${p.pid}`),
    )

    // Skip comparison on first render to avoid false positives after page refresh
    if (prevKeysRef.current !== null) {
      const prev = prevKeysRef.current
      const removedKeys: string[] = []

      for (const key of prev) {
        if (!currentKeys.has(key) && subscriptions[key]) {
          removedKeys.push(key)
        }
      }

      if (removedKeys.length > 0) {
        setSubscriptions((prev) => {
          const next = { ...prev }
          for (const key of removedKeys) {
            const sub = next[key]
            if (sub) {
              sendNotification(`✅ ${sub.command}`, {
                body: sub.terminalName,
                audio: 'done',
              })
              delete next[key]
            }
          }
          return next
        })
      }

      // Stale subscription cleanup: remove subscriptions for processes not in current list
      const staleCounts = staleCountRef.current
      const subKeys = Object.keys(subscriptions)
      for (const key of subKeys) {
        if (!currentKeys.has(key)) {
          staleCounts[key] = (staleCounts[key] || 0) + 1
          if (staleCounts[key] >= 2) {
            setSubscriptions((prev) => {
              const next = { ...prev }
              delete next[key]
              return next
            })
            delete staleCounts[key]
          }
        } else {
          delete staleCounts[key]
        }
      }
    }

    prevKeysRef.current = currentKeys
  }, [processes, subscriptions, sendNotification, setSubscriptions])

  const subscribeToBell = (process: ActiveProcess, terminalName: string) => {
    if (!process.terminalId || process.pid <= 0) return
    const key = `${process.terminalId}:${process.pid}`
    setSubscriptions((prev) => ({
      ...prev,
      [key]: {
        terminalId: process.terminalId!,
        pid: process.pid,
        command: process.command,
        terminalName,
      },
    }))
  }

  const unsubscribeFromBell = (terminalId: number, pid: number) => {
    const key = `${terminalId}:${pid}`
    setSubscriptions((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const isBellSubscribed = (terminalId: number, pid: number) => {
    return `${terminalId}:${pid}` in subscriptions
  }

  const value = useMemo(
    () => ({
      processes,
      terminalPorts,
      gitDirtyStatus,
      gitRemoteSyncStatus,
      subscribeToBell,
      unsubscribeFromBell,
      isBellSubscribed,
    }),
    [
      processes,
      terminalPorts,
      gitDirtyStatus,
      gitRemoteSyncStatus,
      subscriptions,
    ],
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
