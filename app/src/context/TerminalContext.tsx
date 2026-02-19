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
import { toast } from '@/components/ui/sonner'
import type {
  MergedPRSummary,
  PRCheckStatus,
  PRChecksPayload,
  PRReaction,
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
    workspaces_root?: string
    setup_script?: string
    delete_script?: string
    source_terminal_id?: number
  }) => Promise<Terminal>
  updateTerminal: (
    id: number,
    updates: {
      name?: string
      settings?: { defaultClaudeCommand?: string } | null
    },
  ) => Promise<Terminal>
  deleteTerminal: (
    id: number,
    opts?: { deleteDirectory?: boolean },
  ) => Promise<void>
  setTerminalOrder: (value: number[] | ((prev: number[]) => number[])) => void
  refetch: () => void
  ghUsername: string | null
  githubPRs: PRCheckStatus[]
  mergedPRs: MergedPRSummary[]
  hasAnyUnseenPRs: boolean
  activePR: PRCheckStatus | null
  setActivePR: (pr: PRCheckStatus | null) => void
  // Notifications
  notifications: Notification[]
  hasNotifications: boolean
  hasUnreadNotifications: boolean
  markNotificationRead: (id: number) => Promise<void>
  markNotificationReadByItem: (
    repo: string,
    prNumber: number,
    commentId?: number,
    reviewId?: number,
  ) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  markPRNotificationsRead: (repo: string, prNumber: number) => Promise<void>
  deleteAllNotifications: () => Promise<void>
  reactToPR: (
    repo: string,
    prNumber: number,
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove: boolean,
  ) => Promise<void>
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
  const [ghUsername, setGhUsername] = useState<string | null>(null)
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
      if (data.username) setGhUsername(data.username)
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

  // Unread PR notification tracking (DB-backed)
  const [unreadPRData, setUnreadPRData] = useState<
    Map<string, { count: number; itemIds: Set<string> }>
  >(new Map())

  const refetchUnreadPRData = useCallback(async () => {
    try {
      const data = await api.getUnreadPRNotifications()
      const map = new Map<string, { count: number; itemIds: Set<string> }>()
      for (const item of data) {
        const key = `${item.repo}#${item.prNumber}`
        const itemIds = new Set<string>()
        for (const i of item.items) {
          if (i.commentId) itemIds.add(String(i.commentId))
          if (i.reviewId) itemIds.add(String(i.reviewId))
        }
        map.set(key, { count: item.count, itemIds })
      }
      setUnreadPRData(map)
    } catch {
      // silently fail
    }
  }, [])

  // Fetch unread PR data on mount
  useEffect(() => {
    refetchUnreadPRData()
  }, [refetchUnreadPRData])

  // Enrich githubPRs with unread notification status
  const enrichedGithubPRs = useMemo(() => {
    if (unreadPRData.size === 0) return githubPRs
    return githubPRs.map((pr) => {
      const key = `${pr.repo}#${pr.prNumber}`
      const unread = unreadPRData.get(key)
      if (!unread) return pr
      const ids = unread.itemIds
      const markComment = (c: (typeof pr.comments)[0]) =>
        c.id && ids.has(String(c.id)) ? { ...c, isUnread: true } : c
      const markReview = (r: (typeof pr.reviews)[0]) =>
        r.id && ids.has(String(r.id)) ? { ...r, isUnread: true } : r
      return {
        ...pr,
        hasUnreadNotifications: true,
        comments: pr.comments.map(markComment),
        reviews: pr.reviews.map(markReview),
        discussion: pr.discussion.map((item) => {
          if (item.type === 'comment') {
            return { ...item, comment: markComment(item.comment) }
          }
          if (item.type === 'review') {
            return {
              ...item,
              review: markReview(item.review),
              threads: item.threads.map((t) => ({
                ...t,
                comments: t.comments.map(markComment),
              })),
            }
          }
          if (item.type === 'thread') {
            return {
              ...item,
              thread: {
                ...item.thread,
                comments: item.thread.comments.map(markComment),
              },
            }
          }
          return item
        }),
      }
    })
  }, [githubPRs, unreadPRData])

  const hasAnyUnseenPRs = unreadPRData.size > 0

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
      refetchUnreadPRData()
    })
  }, [subscribe, refetchUnreadPRData])

  const hasNotifications = notifications.length > 0

  const hasUnreadNotifications = useMemo(
    () => notifications.some((n) => !n.read),
    [notifications],
  )

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  )

  const markNotificationRead = useCallback(
    async (id: number) => {
      try {
        await api.markNotificationRead(id)
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        )
        refetchUnreadPRData()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as read',
        )
      }
    },
    [refetchUnreadPRData],
  )

  const markNotificationReadByItem = useCallback(
    async (
      repo: string,
      prNumber: number,
      commentId?: number,
      reviewId?: number,
    ) => {
      try {
        await api.markNotificationReadByItem(
          repo,
          prNumber,
          commentId,
          reviewId,
        )
        setNotifications((prev) =>
          prev.map((n) => {
            if (n.repo !== repo || n.data.prNumber !== prNumber || n.read)
              return n
            if (commentId && n.data.commentId === commentId)
              return { ...n, read: true }
            if (reviewId && n.data.reviewId === reviewId)
              return { ...n, read: true }
            return n
          }),
        )
        refetchUnreadPRData()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as read',
        )
      }
    },
    [refetchUnreadPRData],
  )

  const markAllNotificationsRead = useCallback(async () => {
    try {
      await api.markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadPRData(new Map())
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to mark notifications as read',
      )
    }
  }, [])

  const markPRNotificationsRead = useCallback(
    async (repo: string, prNumber: number) => {
      try {
        await api.markPRNotificationsRead(repo, prNumber)
        setNotifications((prev) =>
          prev.map((n) =>
            n.repo === repo && n.data.prNumber === prNumber
              ? { ...n, read: true }
              : n,
          ),
        )
        setUnreadPRData((prev) => {
          const next = new Map(prev)
          next.delete(`${repo}#${prNumber}`)
          return next
        })
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as read',
        )
      }
    },
    [],
  )

  const deleteAllNotifications = useCallback(async () => {
    try {
      await api.deleteAllNotifications()
      setNotifications([])
      setUnreadPRData(new Map())
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete notifications',
      )
    }
  }, [])

  const updatePRReaction = useCallback(
    (
      repo: string,
      prNumber: number,
      subjectId: number,
      subjectType: 'issue_comment' | 'review_comment' | 'review',
      content: string,
      remove: boolean,
    ) => {
      setGithubPRs((prev) =>
        prev.map((pr) => {
          if (pr.repo !== repo || pr.prNumber !== prNumber) return pr

          const patchReactions = (
            reactions: PRReaction[] | undefined,
          ): PRReaction[] | undefined => {
            const result = (reactions || []).map((r) => ({
              ...r,
              users: [...r.users],
            }))
            const idx = result.findIndex((r) => r.content === content)
            if (remove) {
              if (idx >= 0 && result[idx].viewerHasReacted) {
                result[idx].count--
                result[idx].viewerHasReacted = false
                result[idx].users = result[idx].users.filter(
                  (u) => u !== ghUsername,
                )
                if (result[idx].count <= 0) result.splice(idx, 1)
              }
            } else {
              if (idx >= 0) {
                if (!result[idx].viewerHasReacted) {
                  result[idx].count++
                  result[idx].viewerHasReacted = true
                  if (ghUsername) result[idx].users.push(ghUsername)
                }
              } else {
                result.push({
                  content,
                  count: 1,
                  viewerHasReacted: true,
                  users: ghUsername ? [ghUsername] : [],
                })
              }
            }
            return result.length > 0 ? result : undefined
          }

          const patchComment = <
            T extends { id?: number; reactions?: PRReaction[] },
          >(
            c: T,
          ): T =>
            c.id === subjectId
              ? { ...c, reactions: patchReactions(c.reactions) }
              : c

          if (subjectType === 'review') {
            return {
              ...pr,
              reviews: pr.reviews.map((r) =>
                r.id === subjectId
                  ? { ...r, reactions: patchReactions(r.reactions) }
                  : r,
              ),
              discussion: pr.discussion.map((item) => {
                if (item.type === 'review' && item.review.id === subjectId) {
                  return {
                    ...item,
                    review: {
                      ...item.review,
                      reactions: patchReactions(item.review.reactions),
                    },
                  }
                }
                return item
              }),
            }
          }

          return {
            ...pr,
            comments: pr.comments.map(patchComment),
            discussion: pr.discussion.map((item) => {
              if (item.type === 'comment' && item.comment.id === subjectId) {
                return { ...item, comment: patchComment(item.comment) }
              }
              if (item.type === 'review') {
                return {
                  ...item,
                  threads: item.threads.map((thread) => ({
                    ...thread,
                    comments: thread.comments.map(patchComment),
                  })),
                }
              }
              if (item.type === 'thread') {
                return {
                  ...item,
                  thread: {
                    ...item.thread,
                    comments: item.thread.comments.map(patchComment),
                  },
                }
              }
              return item
            }),
          }
        }),
      )
    },
    [ghUsername],
  )

  const reactToPR = useCallback(
    async (
      repo: string,
      prNumber: number,
      subjectId: number,
      subjectType: 'issue_comment' | 'review_comment' | 'review',
      content: string,
      remove: boolean,
    ) => {
      updatePRReaction(repo, prNumber, subjectId, subjectType, content, remove)

      const [owner, repoName] = repo.split('/')
      const prNum = subjectType === 'review' ? prNumber : undefined
      try {
        if (remove) {
          await api.removeReaction(
            owner,
            repoName,
            subjectId,
            subjectType,
            content,
            prNum,
          )
        } else {
          await api.addReaction(
            owner,
            repoName,
            subjectId,
            subjectType,
            content,
            prNum,
          )
        }
      } catch (err) {
        updatePRReaction(
          repo,
          prNumber,
          subjectId,
          subjectType,
          content,
          !remove,
        )
        throw err
      }
    },
    [updatePRReaction],
  )

  // Update app badge based on unread notifications or unseen PRs

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
    async (
      id: number,
      updates: {
        name?: string
        settings?: { defaultClaudeCommand?: string } | null
      },
    ) => {
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
      ghUsername,
      githubPRs: enrichedGithubPRs,
      mergedPRs,
      hasAnyUnseenPRs,
      activePR,
      setActivePR,
      notifications,
      hasNotifications,
      hasUnreadNotifications,
      markNotificationRead,
      markNotificationReadByItem,
      markAllNotificationsRead,
      markPRNotificationsRead,
      deleteAllNotifications,
      reactToPR,
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
      ghUsername,
      enrichedGithubPRs,
      mergedPRs,
      hasAnyUnseenPRs,
      activePR,
      notifications,
      hasNotifications,
      hasUnreadNotifications,
      markNotificationRead,
      markNotificationReadByItem,
      markAllNotificationsRead,
      markPRNotificationsRead,
      deleteAllNotifications,
      reactToPR,
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
