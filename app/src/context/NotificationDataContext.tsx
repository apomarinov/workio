import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import useSWR from 'swr'
import { toast } from '@/components/ui/sonner'
import { resolveNotification } from '../../shared/notifications'
import { useSocket } from '../hooks/useSocket'
import * as api from '../lib/api'
import type { Notification } from '../types'
import { useNotifications } from './NotificationContext'

const UNREAD_PR_KEY = '/api/notifications/pr-unread'

async function fetchUnreadPRData() {
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
  return map
}

interface NotificationDataContextValue {
  notifications: Notification[]
  hasNotifications: boolean
  hasUnreadNotifications: boolean
  hasAnyUnseenPRs: boolean
  markNotificationRead: (id: number) => Promise<void>
  markNotificationUnread: (id: number) => Promise<void>
  markNotificationReadByItem: (
    repo: string,
    prNumber: number,
    commentId?: number,
    reviewId?: number,
  ) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  markPRNotificationsRead: (repo: string, prNumber: number) => Promise<void>
  deleteNotification: (id: number) => Promise<void>
  deleteAllNotifications: () => Promise<void>
  refetchNotifications: () => void
}

const NotificationDataContext =
  createContext<NotificationDataContextValue | null>(null)

export function NotificationDataProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { subscribe } = useSocket()
  const { sendNotification } = useNotifications()
  const sendNotificationRef = useRef(sendNotification)
  sendNotificationRef.current = sendNotification
  const notifDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )

  // Notifications (SWR-backed for multi-client sync)
  const { data: notifications = [], mutate: mutateNotifications } = useSWR<
    Notification[]
  >('/api/notifications', () =>
    api.getNotifications().then((r) => r.notifications),
  )

  // Unread PR data via SWR (shared cache key with GitHubContext)
  const { data: unreadPRData = new Map(), mutate: mutateUnreadPRData } = useSWR(
    UNREAD_PR_KEY,
    fetchUnreadPRData,
  )

  const hasAnyUnseenPRs = unreadPRData.size > 0

  // Subscribe to server-side notifications — OS notification sending
  useEffect(() => {
    return subscribe<Notification>('notifications:new', (notification) => {
      const { type, data } = notification
      const prUrl = data.prUrl || ''
      const notiData = data as unknown as Record<string, unknown>

      let url: string | undefined = prUrl || undefined
      if (type === 'check_failed') url = data.checkUrl || prUrl
      else if (type === 'new_comment' || type === 'pr_mentioned')
        url = data.commentUrl || prUrl
      else if (
        (type === 'new_review' ||
          type === 'changes_requested' ||
          type === 'pr_approved') &&
        data.reviewId &&
        prUrl
      )
        url = `${prUrl}#pullrequestreview-${data.reviewId}`

      const sendOsNotif = (overrideBody?: string) => {
        const resolved = resolveNotification(type, notiData)
        const title = `${resolved.emoji} ${resolved.title}`
        const body = overrideBody ?? resolved.body
        sendNotificationRef.current(title, {
          body,
          audio: resolved.audio,
          data: url ? { url } : undefined,
        })
      }

      // Debounce comments and reviews
      if (type === 'new_comment') {
        const commentKey = `comment:${prUrl}`
        const existing = notifDebounceRef.current.get(commentKey)
        if (existing) clearTimeout(existing)
        notifDebounceRef.current.set(
          commentKey,
          setTimeout(() => {
            notifDebounceRef.current.delete(commentKey)
            const prTitle = data.prTitle || ''
            const truncatedTitle =
              prTitle.length > 50 ? `${prTitle.slice(0, 50)}…` : prTitle
            sendOsNotif(
              data.body ? `${truncatedTitle}\n${data.body}` : truncatedTitle,
            )
          }, 2000),
        )
      } else if (type === 'new_review') {
        const reviewKey = `review:${prUrl}`
        const existing = notifDebounceRef.current.get(reviewKey)
        if (existing) clearTimeout(existing)
        notifDebounceRef.current.set(
          reviewKey,
          setTimeout(() => {
            notifDebounceRef.current.delete(reviewKey)
            const prTitle = data.prTitle || ''
            const truncatedTitle =
              prTitle.length > 50 ? `${prTitle.slice(0, 50)}…` : prTitle
            sendOsNotif(
              data.body ? `${truncatedTitle}\n${data.body}` : truncatedTitle,
            )
          }, 2000),
        )
      } else {
        sendOsNotif()
      }
    })
  }, [subscribe])

  // Subscribe to custom notifications (from POST /api/notifications/send)
  useEffect(() => {
    return subscribe<{
      title: string
      body: string
    }>('notification:custom', (data) => {
      sendNotificationRef.current(`📣 ${data.title}`, {
        body: data.body,
        audio: 'done',
      })
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

  // Listen for new notifications from socket — list update
  useEffect(() => {
    return subscribe<Notification>('notifications:new', (notification) => {
      mutateNotifications(
        (prev) => {
          if (!prev) return [notification]
          const exists = prev.some(
            (n) =>
              (n.dedup_hash && n.dedup_hash === notification.dedup_hash) ||
              n.id === notification.id,
          )
          if (exists) return prev
          return [notification, ...prev]
        },
        { revalidate: false },
      )
      mutateUnreadPRData()
    })
  }, [subscribe, mutateNotifications, mutateUnreadPRData])

  // Listen for refetch events from other clients
  useEffect(() => {
    return subscribe<{ group: string }>('refetch', ({ group }) => {
      if (group === 'notifications') mutateNotifications()
    })
  }, [subscribe, mutateNotifications])

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
        mutateNotifications(
          (prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)),
          { revalidate: false },
        )
        mutateUnreadPRData()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as read',
        )
      }
    },
    [mutateNotifications, mutateUnreadPRData],
  )

  const markNotificationUnread = useCallback(
    async (id: number) => {
      try {
        await api.markNotificationUnread(id)
        mutateNotifications(
          (prev) => prev?.map((n) => (n.id === id ? { ...n, read: false } : n)),
          { revalidate: false },
        )
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as unread',
        )
      }
    },
    [mutateNotifications],
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
        mutateNotifications(
          (prev) =>
            prev?.map((n) => {
              if (n.repo !== repo || n.data.prNumber !== prNumber || n.read)
                return n
              if (commentId && n.data.commentId === commentId)
                return { ...n, read: true }
              if (reviewId && n.data.reviewId === reviewId)
                return { ...n, read: true }
              return n
            }),
          { revalidate: false },
        )
        mutateUnreadPRData()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as read',
        )
      }
    },
    [mutateNotifications, mutateUnreadPRData],
  )

  const markAllNotificationsRead = useCallback(async () => {
    try {
      await api.markAllNotificationsRead()
      mutateNotifications((prev) => prev?.map((n) => ({ ...n, read: true })), {
        revalidate: false,
      })
      mutateUnreadPRData(new Map(), { revalidate: false })
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to mark notifications as read',
      )
    }
  }, [mutateNotifications, mutateUnreadPRData])

  const markPRNotificationsRead = useCallback(
    async (repo: string, prNumber: number) => {
      try {
        await api.markPRNotificationsRead(repo, prNumber)
        mutateNotifications(
          (prev) =>
            prev?.map((n) =>
              n.repo === repo && n.data.prNumber === prNumber
                ? { ...n, read: true }
                : n,
            ),
          { revalidate: false },
        )
        mutateUnreadPRData(
          (prev) => {
            if (!prev) return new Map()
            const next = new Map(prev)
            next.delete(`${repo}#${prNumber}`)
            return next
          },
          { revalidate: false },
        )
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to mark as read',
        )
      }
    },
    [mutateNotifications, mutateUnreadPRData],
  )

  const deleteNotification = useCallback(
    async (id: number) => {
      try {
        await api.deleteNotification(id)
        mutateNotifications((prev) => prev?.filter((n) => n.id !== id), {
          revalidate: false,
        })
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to delete notification',
        )
      }
    },
    [mutateNotifications],
  )

  const deleteAllNotifications = useCallback(async () => {
    try {
      await api.deleteAllNotifications()
      mutateNotifications([], { revalidate: false })
      mutateUnreadPRData(new Map(), { revalidate: false })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete notifications',
      )
    }
  }, [mutateNotifications, mutateUnreadPRData])

  const refetchNotifications = () => {
    mutateNotifications()
  }

  // Update app badge based on unread notifications
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return

    if (unreadNotificationCount > 0) {
      navigator.setAppBadge(unreadNotificationCount)
    } else {
      navigator.clearAppBadge?.()
    }
  }, [unreadNotificationCount, hasAnyUnseenPRs])

  const value = useMemo(
    () => ({
      notifications,
      hasNotifications,
      hasUnreadNotifications,
      hasAnyUnseenPRs,
      markNotificationRead,
      markNotificationUnread,
      markNotificationReadByItem,
      markAllNotificationsRead,
      markPRNotificationsRead,
      deleteNotification,
      deleteAllNotifications,
      refetchNotifications,
    }),
    [
      notifications,
      hasNotifications,
      hasUnreadNotifications,
      hasAnyUnseenPRs,
      markNotificationRead,
      markNotificationUnread,
      markNotificationReadByItem,
      markAllNotificationsRead,
      markPRNotificationsRead,
      deleteNotification,
      deleteAllNotifications,
    ],
  )

  return (
    <NotificationDataContext.Provider value={value}>
      {children}
    </NotificationDataContext.Provider>
  )
}

export function useNotificationDataContext() {
  const context = useContext(NotificationDataContext)
  if (!context) {
    throw new Error(
      'useNotificationDataContext must be used within NotificationDataProvider',
    )
  }
  return context
}
