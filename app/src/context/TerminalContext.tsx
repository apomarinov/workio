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
import type { PRCheckStatus, PRChecksPayload } from '../../shared/types'
import { useBrowserNotification } from '../hooks/useBrowserNotification'
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
  githubPRs: PRCheckStatus[]
  hasNewActivity: (pr: PRCheckStatus) => boolean
  markPRSeen: (pr: PRCheckStatus) => void
  markAllPRsSeen: () => void
  hasAnyUnseenPRs: boolean
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

const RECENT_PR_THRESHOLD_MS = 15 * 60 * 1000 // 5 minutes

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { subscribe, emit } = useSocket()
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

  // GitHub PR checks
  const [githubPRs, setGithubPRs] = useState<PRCheckStatus[]>([])
  const { notify } = useBrowserNotification()
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  const [prPoll, setPrPoll] = useState(true)

  useEffect(() => {
    if (!prPoll) {
      return
    }
    const now = Date.now()
    const recentPR = githubPRs
      .filter(
        (pr) =>
          pr.createdAt &&
          now - new Date(pr.createdAt).getTime() < RECENT_PR_THRESHOLD_MS,
      )
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0]
    // Trigger git fetch only if no terminal already has a branch matching that PR
    if (recentPR) {
      const terminalBranches = new Set(
        raw.map((t) => t.git_branch).filter(Boolean),
      )
      if (!terminalBranches.has(recentPR.branch)) {
        setPrPoll(false)
        emit('detect-branches')
      }
    }
  }, [githubPRs, prPoll, raw, emit])

  useEffect(() => {
    return subscribe<PRChecksPayload>('github:pr-checks', (data) => {
      setGithubPRs(data.prs)

      setPrPoll(true)
      // Browser notification for new PR activity
      const lastNotifAt = localStorage.getItem('pr-activity-notif-at') ?? ''
      const unseenCount = data.prs.filter(
        (pr) => pr.updatedAt && pr.updatedAt > lastNotifAt,
      ).length
      if (unseenCount > 0) {
        const sent = notifyRef.current(
          `New activity on ${unseenCount} PR${unseenCount !== 1 ? 's' : ''}`,
          { audio: '/audio/pr-noti.mp3' },
        )
        if (sent) {
          localStorage.setItem('pr-activity-notif-at', new Date().toISOString())
        }
      }
    })
  }, [subscribe])

  // PR seen tracking
  const [prSeenTimes, setPRSeenTimes] = useLocalStorage<Record<string, string>>(
    'pr-seen-times',
    {},
  )

  const hasNewActivity = useCallback(
    (pr: PRCheckStatus): boolean => {
      if (!pr.updatedAt) return false
      const seen = prSeenTimes[`${pr.repo}#${pr.prNumber}`]
      if (!seen) return true
      return pr.updatedAt > seen
    },
    [prSeenTimes],
  )

  const markPRSeen = useCallback(
    (pr: PRCheckStatus): void => {
      if (!pr.updatedAt) return
      const key = `${pr.repo}#${pr.prNumber}`
      setPRSeenTimes((prev) => {
        if (prev[key] === pr.updatedAt) return prev
        return { ...prev, [key]: pr.updatedAt }
      })
    },
    [setPRSeenTimes],
  )

  const markAllPRsSeen = useCallback(() => {
    setPRSeenTimes((prev) => {
      const next = { ...prev }
      for (const pr of githubPRs) {
        if (pr.updatedAt) {
          next[`${pr.repo}#${pr.prNumber}`] = pr.updatedAt
        }
      }
      return next
    })
  }, [githubPRs, setPRSeenTimes])

  const hasAnyUnseenPRs = useMemo(
    () =>
      githubPRs.some((pr) => {
        if (!pr.updatedAt) return false
        const seen = prSeenTimes[`${pr.repo}#${pr.prNumber}`]
        if (!seen) return true
        return pr.updatedAt > seen
      }),
    [githubPRs, prSeenTimes],
  )

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
        githubPRs,
        hasNewActivity,
        markPRSeen,
        markAllPRsSeen,
        hasAnyUnseenPRs,
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
