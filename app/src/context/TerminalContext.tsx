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
import type {
  ActiveProcess,
  PRCheckStatus,
  PRChecksPayload,
  ProcessesPayload,
  WorkspacePayload,
} from '../../shared/types'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSocket } from '../hooks/useSocket'
import * as api from '../lib/api'
import type { Terminal } from '../types'
import { useNotifications } from './NotificationContext'

interface TerminalContextValue {
  terminals: Terminal[]
  loading: boolean
  activeTerminal: Terminal | null
  selectTerminal: (id: number) => void
  createTerminal: (opts: {
    cwd: string
    name?: string
    shell?: string
    ssh_host?: string
    git_repo?: string
    conductor?: boolean
    workspaces_root?: string
    setup_script?: string
    delete_script?: string
    source_terminal_id?: number
  }) => Promise<Terminal>
  updateTerminal: (
    id: number,
    updates: { name?: string; cwd?: string },
  ) => Promise<Terminal>
  deleteTerminal: (
    id: number,
    opts?: { deleteDirectory?: boolean },
  ) => Promise<void>
  setTerminalOrder: (value: number[] | ((prev: number[]) => number[])) => void
  refetch: () => void
  githubPRs: PRCheckStatus[]
  hasNewActivity: (pr: PRCheckStatus) => boolean
  markPRSeen: (pr: PRCheckStatus) => void
  markAllPRsSeen: () => void
  hasAnyUnseenPRs: boolean
  processes: ActiveProcess[]
  terminalPorts: Record<number, number[]>
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

  // Handle workspace setup/archive events (merge state without refetching)
  useEffect(() => {
    return subscribe<WorkspacePayload>('terminal:workspace', (data) => {
      if (data.deleted) {
        sendNotificationRef.current(`✅ ${data.name} deleted`, {
          audio: 'pr-activity',
        })
        mutate((prev) => prev?.filter((t) => t.id !== data.terminalId), false)
        return
      }
      if (data.setup?.status === 'done') {
        sendNotificationRef.current(`✅ ${data.name} is ready`, {
          audio: 'pr-activity',
        })
      }
      if (data.setup?.status === 'failed') {
        sendNotificationRef.current(`❌ ${data.name} failed`, {
          audio: 'pr-activity',
        })
      }
      if (data.git_repo?.status === 'failed') {
        sendNotificationRef.current(`❌ ${data.name} failed repo init`, {
          audio: 'pr-activity',
        })
      }
      mutate(
        (prev) =>
          prev?.map((t) => {
            if (t.id !== data.terminalId) return t
            return {
              ...t,
              ...(data.name && { name: data.name }),
              ...(data.git_repo && { git_repo: data.git_repo }),
              ...(data.setup && { setup: data.setup }),
            }
          }),
        false,
      )
    })
  }, [subscribe, mutate])

  // GitHub PR checks
  const [githubPRs, setGithubPRs] = useState<PRCheckStatus[]>([])
  const { sendNotification } = useNotifications()
  const sendNotificationRef = useRef(sendNotification)
  sendNotificationRef.current = sendNotification
  const [prPoll, setPrPoll] = useState(true)
  const lastDetectEmitRef = useRef(0)

  useEffect(() => {
    if (!prPoll) {
      return
    }
    const now = Date.now()
    // Cooldown: don't re-emit detect-branches within 30 seconds
    if (now - lastDetectEmitRef.current < 30_000) {
      return
    }
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
        lastDetectEmitRef.current = now
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
        const sent = sendNotificationRef.current(
          `New activity on ${unseenCount} PR${unseenCount !== 1 ? 's' : ''}`,
          { audio: 'pr-activity' },
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

  // Process & port tracking (moved from useProcesses hook)
  const [processes, setProcesses] = useState<ActiveProcess[]>([])
  const [terminalPorts, setTerminalPorts] = useState<Record<number, number[]>>(
    {},
  )

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
            // Partial update: merge ports for this terminal
            const next = { ...prev }
            const ports = data.ports?.[data.terminalId]
            if (ports && ports.length > 0) {
              next[data.terminalId] = ports
            } else {
              delete next[data.terminalId]
            }
            return next
          }
          // Full update: replace all ports
          return data.ports ?? {}
        })
      }
    })
  }, [subscribe])

  const activeTerminal = useMemo(
    () => terminals.find((t) => t.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId],
  )

  const createTerminal = useCallback(
    async (opts: {
      cwd: string
      name?: string
      shell?: string
      ssh_host?: string
      git_repo?: string
      conductor?: boolean
      workspaces_root?: string
      setup_script?: string
      delete_script?: string
      source_terminal_id?: number
    }) => {
      const terminal = await api.createTerminal(opts)
      mutate((prev) => (prev ? [terminal, ...prev] : [terminal]), false)
      return terminal
    },
    [mutate],
  )

  const updateTerminal = useCallback(
    async (id: number, updates: { name?: string; cwd?: string }) => {
      const updated = await api.updateTerminal(id, updates)
      mutate((prev) => prev?.map((t) => (t.id === id ? updated : t)), false)
      return updated
    },
    [mutate],
  )

  const deleteTerminal = useCallback(
    async (id: number, opts?: { deleteDirectory?: boolean }) => {
      const isAsync = await api.deleteTerminal(id, opts)
      if (!isAsync) {
        mutate((prev) => prev?.filter((t) => t.id !== id), false)
      }
      // For async (202), the WebSocket 'terminal:workspace' event
      // will update setup.status to 'delete' and eventually emit { deleted: true }
    },
    [mutate],
  )

  const refetch = useCallback(() => mutate(), [mutate])

  const value = useMemo(
    () => ({
      terminals,
      loading: isLoading,
      activeTerminal,
      selectTerminal: setActiveTerminalId,
      createTerminal,
      updateTerminal,
      deleteTerminal,
      setTerminalOrder,
      refetch,
      githubPRs,
      hasNewActivity,
      markPRSeen,
      markAllPRsSeen,
      hasAnyUnseenPRs,
      processes,
      terminalPorts,
    }),
    [
      terminals,
      isLoading,
      activeTerminal,
      createTerminal,
      updateTerminal,
      deleteTerminal,
      setTerminalOrder,
      refetch,
      githubPRs,
      hasNewActivity,
      markPRSeen,
      markAllPRsSeen,
      hasAnyUnseenPRs,
      processes,
      terminalPorts,
    ],
  )

  return (
    <TerminalContext.Provider value={value}>
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
