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
  PRCheckStatus,
  PRChecksPayload,
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
  const previousTerminalIdRef = useRef<number | null>(null)

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
  const previousPRsRef = useRef<Map<string, PRCheckStatus>>(new Map())
  const { sendNotification } = useNotifications()
  const sendNotificationRef = useRef(sendNotification)
  sendNotificationRef.current = sendNotification
  const [prPoll, setPrPoll] = useState(true)
  const lastDetectEmitRef = useRef(0)
  const [hiddenAuthors] = useLocalStorage<string[]>(
    'hidden-comment-authors',
    [],
  )
  const hiddenAuthorsRef = useRef(new Set(hiddenAuthors))
  hiddenAuthorsRef.current = new Set(hiddenAuthors)

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
    const hasFailedChecks = (pr: PRCheckStatus) =>
      pr.checks.some(
        (c) =>
          c.status === 'COMPLETED' &&
          c.conclusion !== 'SUCCESS' &&
          c.conclusion !== 'SKIPPED' &&
          c.conclusion !== 'NEUTRAL',
      )

    const revealPR = (pr: PRCheckStatus) => {
      window.dispatchEvent(
        new CustomEvent('reveal-pr', {
          detail: { branch: pr.branch, repo: pr.repo },
        }),
      )
    }

    return subscribe<PRChecksPayload>('github:pr-checks', (data) => {
      const prevMap = previousPRsRef.current

      // Only send notifications if we have previous state (not initial load)
      if (prevMap.size > 0) {
        for (const pr of data.prs) {
          const key = `${pr.repo}#${pr.prNumber}`
          const prev = prevMap.get(key)

          // PR merged
          if (prev && prev.state !== 'MERGED' && pr.state === 'MERGED') {
            sendNotificationRef.current('✅ Merged', {
              body: pr.prTitle,
              audio: 'pr-activity',
              onClick: () => revealPR(pr),
            })
          }

          // Check failed (had no failures, now has failures)
          if (prev && !hasFailedChecks(prev) && hasFailedChecks(pr)) {
            sendNotificationRef.current('❌ Check failed', {
              body: pr.prTitle,
              audio: 'pr-activity',
              onClick: () => revealPR(pr),
            })
          }

          // Changes requested
          if (
            prev &&
            prev.reviewDecision !== 'CHANGES_REQUESTED' &&
            pr.reviewDecision === 'CHANGES_REQUESTED'
          ) {
            sendNotificationRef.current('🔄 Changes requested', {
              body: pr.prTitle,
              audio: 'pr-activity',
              onClick: () => revealPR(pr),
            })
          }

          // Approved
          if (
            prev &&
            prev.reviewDecision !== 'APPROVED' &&
            pr.reviewDecision === 'APPROVED'
          ) {
            sendNotificationRef.current('✅ Approved', {
              body: pr.prTitle,
              audio: 'pr-activity',
              onClick: () => revealPR(pr),
            })
          }

          // New comments (skip if from current user or hidden author)
          if (prev && pr.comments.length > 0) {
            const prevCommentKeys = new Set(
              prev.comments.map((c) => `${c.author}:${c.createdAt}`),
            )
            for (const comment of pr.comments) {
              if (data.username && comment.author === data.username) continue
              if (hiddenAuthorsRef.current.has(comment.author)) continue
              const commentKey = `${comment.author}:${comment.createdAt}`
              if (!prevCommentKeys.has(commentKey)) {
                sendNotificationRef.current(`💬 ${comment.author} commented`, {
                  body: comment.body,
                  audio: 'pr-activity',
                  onClick: () => window.open(pr.prUrl, '_blank'),
                })
              }
            }
          }

          // New reviews (skip if from current user or hidden author)
          if (prev && pr.reviews.length > 0) {
            const prevReviewKeys = new Set(
              prev.reviews.map((r) => `${r.author}:${r.state}`),
            )
            for (const review of pr.reviews) {
              if (data.username && review.author === data.username) continue
              if (hiddenAuthorsRef.current.has(review.author)) continue
              const reviewKey = `${review.author}:${review.state}`
              if (!prevReviewKeys.has(reviewKey)) {
                const emoji =
                  review.state === 'APPROVED'
                    ? '✅'
                    : review.state === 'CHANGES_REQUESTED'
                      ? '🔄'
                      : '💬'
                const action =
                  review.state === 'APPROVED'
                    ? 'approved'
                    : review.state === 'CHANGES_REQUESTED'
                      ? 'requested changes'
                      : 'reviewed'
                sendNotificationRef.current(
                  `${emoji} ${review.author} ${action}`,
                  {
                    body: review.body || pr.prTitle,
                    audio: 'pr-activity',
                    onClick: () => window.open(pr.prUrl, '_blank'),
                  },
                )
              }
            }
          }
        }
      }

      // Update previous state
      const newMap = new Map<string, PRCheckStatus>()
      for (const pr of data.prs) {
        newMap.set(`${pr.repo}#${pr.prNumber}`, pr)
      }
      previousPRsRef.current = newMap

      setGithubPRs(data.prs)
      setPrPoll(true)
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
      return terminal
    },
    [mutate],
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
      hasNewActivity,
      markPRSeen,
      markAllPRsSeen,
      hasAnyUnseenPRs,
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
      hasNewActivity,
      markPRSeen,
      markAllPRsSeen,
      hasAnyUnseenPRs,
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
