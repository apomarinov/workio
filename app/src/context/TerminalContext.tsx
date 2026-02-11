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
  MergedPRSummary,
  PRCheckStatus,
  PRChecksPayload,
  WorkspacePayload,
} from '../../shared/types'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSocket } from '../hooks/useSocket'
import * as api from '../lib/api'
import type { Notification, Terminal } from '../types'
import { useNotifications } from './NotificationContext'

interface TerminalContextValue {
  terminals: Terminal[]
  loading: boolean
  activeTerminal: Terminal | null
  selectTerminal: (id: number) => void
  selectPreviousTerminal: () => void
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
  updateTerminal: (id: number, updates: { name?: string }) => Promise<Terminal>
  deleteTerminal: (
    id: number,
    opts?: { deleteDirectory?: boolean },
  ) => Promise<void>
  setTerminalOrder: (value: number[] | ((prev: number[]) => number[])) => void
  refetch: () => void
  githubPRs: PRCheckStatus[]
  mergedPRs: MergedPRSummary[]
  hasNewActivity: (pr: PRCheckStatus) => boolean
  markPRSeen: (pr: PRCheckStatus) => void
  markAllPRsSeen: () => void
  hasAnyUnseenPRs: boolean
  activePR: PRCheckStatus | null
  setActivePR: (pr: PRCheckStatus | null) => void
  // Notifications
  notifications: Notification[]
  hasNotifications: boolean
  hasUnreadNotifications: boolean
  markNotificationRead: (id: number) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  deleteAllNotifications: () => Promise<void>
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
  const previousTerminalIdRef = useRef<number | null>(null)
  const [activePR, setActivePR] = useState<PRCheckStatus | null>(null)

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

  // Update terminal state in-place when server emits changes
  useEffect(() => {
    return subscribe(
      'terminal:updated',
      ({
        terminalId,
        data,
      }: {
        terminalId: number
        data: Partial<Terminal>
      }) => {
        mutate(
          (prev) =>
            prev?.map((t) => (t.id === terminalId ? { ...t, ...data } : t)),
          false,
        )
      },
    )
  }, [subscribe, mutate])

  // Handle terminal:workspace events for state updates
  // (Browser notifications for workspace events are handled via notifications:new)
  useEffect(() => {
    return subscribe<WorkspacePayload>('terminal:workspace', (data) => {
      if (data.deleted) {
        mutate((prev) => prev?.filter((t) => t.id !== data.terminalId), false)
        return
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
  const notifDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )
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

  // Subscribe to PR checks updates
  useEffect(() => {
    return subscribe<PRChecksPayload>('github:pr-checks', (data) => {
      setGithubPRs(data.prs)
      setPrPoll(true)
    })
  }, [subscribe])

  // Subscribe to server-side notifications
  useEffect(() => {
    return subscribe<Notification>('notifications:new', (notification) => {
      const { type, data } = notification
      const prTitle = data.prTitle || ''
      const prUrl = data.prUrl || ''

      switch (type) {
        case 'pr_merged':
          sendNotificationRef.current('✅ Merged', {
            body: prTitle,
            audio: 'pr-activity',
            onClick: () => window.open(prUrl, '_blank'),
          })
          break

        case 'pr_closed':
          sendNotificationRef.current('🚫 Closed', {
            body: prTitle,
            audio: 'pr-activity',
            onClick: () => window.open(prUrl, '_blank'),
          })
          break

        case 'checks_passed':
          sendNotificationRef.current('✅ All checks passed', {
            body: prTitle,
            audio: 'done',
            onClick: () => window.open(prUrl, '_blank'),
          })
          break

        case 'check_failed':
          sendNotificationRef.current('❌ Check failed', {
            body: data.checkName ? `${data.checkName} - ${prTitle}` : prTitle,
            audio: 'error',
            onClick: () => window.open(data.checkUrl || prUrl, '_blank'),
          })
          break

        case 'changes_requested':
          sendNotificationRef.current('🔄 Changes requested', {
            body: data.reviewer ? `${data.reviewer} on ${prTitle}` : prTitle,
            audio: 'error',
            onClick: () => window.open(prUrl, '_blank'),
          })
          break

        case 'pr_approved':
          sendNotificationRef.current('✅ Approved', {
            body: data.approver
              ? `${data.approver} approved ${prTitle}`
              : prTitle,
            audio: 'pr-activity',
            onClick: () => window.open(prUrl, '_blank'),
          })
          break

        case 'new_comment': {
          const commentKey = `comment:${prUrl}`
          const existingComment = notifDebounceRef.current.get(commentKey)
          if (existingComment) clearTimeout(existingComment)
          notifDebounceRef.current.set(
            commentKey,
            setTimeout(() => {
              notifDebounceRef.current.delete(commentKey)
              sendNotificationRef.current(`💬 ${data.author || 'Someone'}`, {
                body: data.body || prTitle,
                audio: 'pr-activity',
                onClick: () => window.open(data.commentUrl || prUrl, '_blank'),
              })
            }, 2000),
          )
          break
        }

        case 'new_review': {
          const reviewKey = `review:${prUrl}`
          const existingReview = notifDebounceRef.current.get(reviewKey)
          if (existingReview) clearTimeout(existingReview)
          const emoji =
            data.state === 'APPROVED'
              ? '✅'
              : data.state === 'CHANGES_REQUESTED'
                ? '🔄'
                : '💬'
          const action =
            data.state === 'APPROVED'
              ? 'approved'
              : data.state === 'CHANGES_REQUESTED'
                ? 'requested changes'
                : 'reviewed'
          const reviewUrl = data.reviewId
            ? `${prUrl}#pullrequestreview-${data.reviewId}`
            : prUrl
          notifDebounceRef.current.set(
            reviewKey,
            setTimeout(() => {
              notifDebounceRef.current.delete(reviewKey)
              sendNotificationRef.current(
                `${emoji} ${data.author || 'Someone'} ${action}`,
                {
                  body: data.body || prTitle,
                  audio: 'pr-activity',
                  onClick: () => window.open(reviewUrl, '_blank'),
                },
              )
            }, 2000),
          )
          break
        }

        // Workspace notifications (state updates handled by terminal:workspace handler)
        case 'workspace_deleted':
          sendNotificationRef.current(`✅ ${data.name} deleted`, {
            audio: 'pr-activity',
          })
          break

        case 'workspace_ready':
          sendNotificationRef.current(`✅ ${data.name} is ready`, {
            audio: 'pr-activity',
          })
          break

        case 'workspace_failed':
          sendNotificationRef.current(`❌ ${data.name} failed`, {
            audio: 'error',
          })
          break

        case 'workspace_repo_failed':
          sendNotificationRef.current(`❌ ${data.name} repo init failed`, {
            audio: 'error',
          })
          break
      }
    })
  }, [subscribe])

  // Clean up notification debounce timers on unmount
  useEffect(() => {
    const debounceMap = notifDebounceRef.current
    return () => {
      for (const timer of debounceMap.values()) {
        clearTimeout(timer)
      }
      debounceMap.clear()
    }
  }, [])

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

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([])

  // Fetch notifications on mount
  useEffect(() => {
    let cancelled = false
    async function fetchNotifications() {
      try {
        const result = await api.getNotifications()
        if (!cancelled) {
          setNotifications(result.notifications)
        }
      } catch {
        // silently fail
      }
    }
    fetchNotifications()
    return () => {
      cancelled = true
    }
  }, [])

  // Listen for new notifications from socket
  useEffect(() => {
    return subscribe<Notification>('notifications:new', (notification) => {
      setNotifications((prev) => {
        // Check if notification already exists (by dedup_hash or id)
        const exists = prev.some(
          (n) =>
            (n.dedup_hash && n.dedup_hash === notification.dedup_hash) ||
            n.id === notification.id,
        )
        if (exists) return prev
        return [notification, ...prev]
      })
    })
  }, [subscribe])

  const hasNotifications = notifications.length > 0

  const hasUnreadNotifications = useMemo(
    () => notifications.some((n) => !n.read),
    [notifications],
  )

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  )

  const markNotificationRead = useCallback(async (id: number) => {
    await api.markNotificationRead(id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    )
  }, [])

  const markAllNotificationsRead = useCallback(async () => {
    await api.markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    markAllPRsSeen()
  }, [markAllPRsSeen])

  const deleteAllNotifications = useCallback(async () => {
    await api.deleteAllNotifications()
    setNotifications([])
  }, [])

  // Update app badge based on unread notifications or unseen PRs
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when unseen PRs change to clear badge
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return

    if (unreadNotificationCount > 0) {
      navigator.setAppBadge(unreadNotificationCount)
    } else {
      navigator.clearAppBadge?.()
    }
  }, [unreadNotificationCount, hasAnyUnseenPRs])

  // Fetch merged PRs for all repos
  const [mergedPRs, setMergedPRs] = useState<MergedPRSummary[]>([])

  const repos = useMemo(() => {
    const repoSet = new Set<string>()
    for (const pr of githubPRs) {
      repoSet.add(pr.repo)
    }
    return Array.from(repoSet)
  }, [githubPRs])

  useEffect(() => {
    if (repos.length === 0) {
      setMergedPRs([])
      return
    }

    let cancelled = false

    async function fetchMergedPRs() {
      try {
        const limit = Math.min(repos.length * 10, 100)
        const prs = await api.getClosedPRs(repos, limit)

        if (!cancelled) {
          // Dedupe and exclude PRs already in githubPRs
          const existingPRs = new Set(
            githubPRs.map((pr) => `${pr.repo}#${pr.prNumber}`),
          )
          const seen = new Set<string>()
          const allPRs: MergedPRSummary[] = []
          for (const pr of prs) {
            const key = `${pr.repo}#${pr.prNumber}`
            if (!seen.has(key) && !existingPRs.has(key)) {
              seen.add(key)
              allPRs.push(pr)
            }
          }
          setMergedPRs(allPRs)
        }
      } catch {
        // silently fail
      }
    }

    fetchMergedPRs()

    return () => {
      cancelled = true
    }
  }, [repos, githubPRs])

  const selectTerminal = useCallback((id: number) => {
    setActiveTerminalId((prev) => {
      if (prev !== null && prev !== id) {
        previousTerminalIdRef.current = prev
      }
      return id
    })
  }, [])

  const selectPreviousTerminal = useCallback(() => {
    const prevId = previousTerminalIdRef.current
    if (prevId !== null && terminals.some((t) => t.id === prevId)) {
      selectTerminal(prevId)
    }
  }, [terminals, selectTerminal])

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
      setTerminalOrder((prev) => [terminal.id, ...prev])
      return terminal
    },
    [mutate, setTerminalOrder],
  )

  const updateTerminal = useCallback(
    async (id: number, updates: { name?: string }) => {
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
      selectTerminal,
      selectPreviousTerminal,
      createTerminal,
      updateTerminal,
      deleteTerminal,
      setTerminalOrder,
      refetch,
      githubPRs,
      mergedPRs,
      hasNewActivity,
      markPRSeen,
      markAllPRsSeen,
      hasAnyUnseenPRs,
      activePR,
      setActivePR,
      notifications,
      hasNotifications,
      hasUnreadNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      deleteAllNotifications,
    }),
    [
      terminals,
      isLoading,
      activeTerminal,
      selectTerminal,
      selectPreviousTerminal,
      createTerminal,
      updateTerminal,
      deleteTerminal,
      setTerminalOrder,
      refetch,
      githubPRs,
      mergedPRs,
      hasNewActivity,
      markPRSeen,
      markAllPRsSeen,
      hasAnyUnseenPRs,
      activePR,
      notifications,
      hasNotifications,
      hasUnreadNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      deleteAllNotifications,
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
