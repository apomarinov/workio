import { resolveNotification } from '@domains/notifications/registry'
import type { Notification } from '@domains/notifications/schema'
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useSocket } from '@/hooks/useSocket'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { useNotifications } from './NotificationContext'

export type UnreadPRData = Record<string, { count: number; itemIds: string[] }>
const EMPTY_UNREAD: UnreadPRData = {}

const LIST_INPUT = { limit: 50, offset: 0 }

interface NotificationDataContextValue {
  notifications: Notification[]
  unreadPRData: UnreadPRData
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

  const utils = trpc.useUtils()

  // Notifications via tRPC
  const { data: listData } = trpc.notifications.list.useQuery(LIST_INPUT)
  const notifications = listData?.notifications ?? []

  // Unread PR data via tRPC (shared with GitHubContext)
  const { data: unreadPRData = EMPTY_UNREAD } =
    trpc.notifications.prUnread.useQuery()

  const hasAnyUnseenPRs = Object.keys(unreadPRData).length > 0

  // tRPC mutations
  const markReadMutation = trpc.notifications.markRead.useMutation()
  const markUnreadMutation = trpc.notifications.markUnread.useMutation()
  const markItemReadMutation = trpc.notifications.markItemRead.useMutation()
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation()
  const markPRReadMutation = trpc.notifications.markPRRead.useMutation()
  const removeMutation = trpc.notifications.remove.useMutation()
  const removeAllMutation = trpc.notifications.removeAll.useMutation()

  // Subscribe to server-side notifications — OS notification sending
  useEffect(() => {
    return subscribe<Notification>('notifications:new', (notification) => {
      const { type, data } = notification
      const prUrl = data.prUrl || ''
      const notiData = data as unknown as Record<string, unknown>

      let url: string | undefined = prUrl || undefined
      if (type === 'check_failed') url = data.checkUrl || prUrl
      else if (type === 'checks_failed') url = prUrl || undefined
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
      utils.notifications.list.setData(LIST_INPUT, (prev) => {
        if (!prev) return { notifications: [notification], total: 1 }
        const exists = prev.notifications.some(
          (n) =>
            (n.dedup_hash && n.dedup_hash === notification.dedup_hash) ||
            n.id === notification.id,
        )
        if (exists) return prev
        return {
          notifications: [notification, ...prev.notifications],
          total: prev.total + 1,
        }
      })
      utils.notifications.prUnread.invalidate()
    })
  }, [subscribe, utils])

  // Listen for refetch events from other clients
  useEffect(() => {
    return subscribe<{ group: string }>('refetch', ({ group }) => {
      if (group === 'notifications') utils.notifications.list.invalidate()
    })
  }, [subscribe, utils])

  const hasNotifications = notifications.length > 0

  const hasUnreadNotifications = useMemo(
    () => notifications.some((n) => !n.read),
    [notifications],
  )

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  )

  const markNotificationRead = async (id: number) => {
    try {
      await markReadMutation.mutateAsync({ id })
      utils.notifications.list.setData(LIST_INPUT, (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) =>
                n.id === id ? { ...n, read: true } : n,
              ),
            }
          : prev,
      )
      utils.notifications.prUnread.invalidate()
    } catch (err) {
      toastError(err, 'Failed to mark as read')
    }
  }

  const markNotificationUnread = async (id: number) => {
    try {
      await markUnreadMutation.mutateAsync({ id })
      utils.notifications.list.setData(LIST_INPUT, (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) =>
                n.id === id ? { ...n, read: false } : n,
              ),
            }
          : prev,
      )
      utils.notifications.prUnread.invalidate()
    } catch (err) {
      toastError(err, 'Failed to mark as unread')
    }
  }

  const markNotificationReadByItem = async (
    repo: string,
    prNumber: number,
    commentId?: number,
    reviewId?: number,
  ) => {
    try {
      await markItemReadMutation.mutateAsync({
        repo,
        prNumber,
        commentId,
        reviewId,
      })
      utils.notifications.list.setData(LIST_INPUT, (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) => {
                if (n.repo !== repo || n.data.prNumber !== prNumber || n.read)
                  return n
                if (commentId && n.data.commentId === commentId)
                  return { ...n, read: true }
                if (reviewId && n.data.reviewId === reviewId)
                  return { ...n, read: true }
                return n
              }),
            }
          : prev,
      )
      utils.notifications.prUnread.invalidate()
    } catch (err) {
      toastError(err, 'Failed to mark as read')
    }
  }

  const markAllNotificationsRead = async () => {
    try {
      await markAllReadMutation.mutateAsync()
      utils.notifications.list.setData(LIST_INPUT, (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) => ({
                ...n,
                read: true,
              })),
            }
          : prev,
      )
      utils.notifications.prUnread.setData(undefined, EMPTY_UNREAD)
    } catch (err) {
      toastError(err, 'Failed to mark notifications as read')
    }
  }

  const markPRNotificationsRead = async (repo: string, prNumber: number) => {
    try {
      await markPRReadMutation.mutateAsync({ repo, prNumber })
      utils.notifications.list.setData(LIST_INPUT, (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) =>
                n.repo === repo && n.data.prNumber === prNumber
                  ? { ...n, read: true }
                  : n,
              ),
            }
          : prev,
      )
      utils.notifications.prUnread.setData(undefined, (prev) => {
        if (!prev) return EMPTY_UNREAD
        const next = { ...prev }
        delete next[`${repo}#${prNumber}`]
        return next
      })
    } catch (err) {
      toastError(err, 'Failed to mark as read')
    }
  }

  const deleteNotification = async (id: number) => {
    try {
      await removeMutation.mutateAsync({ id })
      utils.notifications.list.setData(LIST_INPUT, (prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.filter((n) => n.id !== id),
              total: prev.total - 1,
            }
          : prev,
      )
      utils.notifications.prUnread.invalidate()
    } catch (err) {
      toastError(err, 'Failed to delete notification')
    }
  }

  const deleteAllNotifications = async () => {
    try {
      await removeAllMutation.mutateAsync()
      utils.notifications.list.setData(LIST_INPUT, {
        notifications: [],
        total: 0,
      })
      utils.notifications.prUnread.setData(undefined, EMPTY_UNREAD)
    } catch (err) {
      toastError(err, 'Failed to delete notifications')
    }
  }

  const refetchNotifications = () => {
    utils.notifications.list.invalidate()
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
      unreadPRData,
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
      unreadPRData,
      hasNotifications,
      hasUnreadNotifications,
      hasAnyUnseenPRs,
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
