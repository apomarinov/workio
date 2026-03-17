import type { AudioType } from '@domains/notifications/registry'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { toast } from 'sonner'
import { NotificationPrompt } from '../components/NotificationPrompt'
import { useSettings } from '../hooks/useSettings'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

const audioFiles: Record<AudioType, string> = {
  permission: '/audio/permissions.mp3',
  done: '/audio/done.mp3',
  error: '/audio/error.mp3',
  'pr-activity': '/audio/pr-noti.mp3',
  'bell-notify': '/audio/bell-notify.mp3',
}

interface SendNotificationOptions extends NotificationOptions {
  audio?: AudioType
}

interface NotificationContextValue {
  sendNotification: (title: string, options?: SendNotificationOptions) => void
  requestPermission: () => Promise<boolean>
  hasDevicePushSubscription: boolean
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [permission, setPermission] = useState<PermissionState>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported'
    }
    return Notification.permission
  })
  const [promptOpen, setPromptOpen] = useState(false)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const { settings } = useSettings()
  const hasPushSubscriptions = (settings?.push_subscriptions?.length ?? 0) > 0
  const hasDevicePushSubscription =
    hasPushSubscriptions &&
    !!currentEndpoint &&
    settings!.push_subscriptions!.some((s) => s.endpoint === currentEndpoint)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setCurrentEndpoint(sub?.endpoint ?? null))
        .catch(() => {})
    }
  }, [settings?.push_subscriptions])

  useEffect(() => {
    if (permission === 'unsupported') return

    if ('permissions' in navigator) {
      navigator.permissions
        .query({ name: 'notifications' })
        .then((status) => {
          status.onchange = () => setPermission(Notification.permission)
        })
        .catch(() => {
          console.error('Failed to query notifications permission')
        })
    }
  }, [permission])

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (permission === 'unsupported') return false
    if (permission === 'granted') return true

    const result = await Notification.requestPermission()
    setPermission(result)
    setPromptOpen(false)
    return result === 'granted'
  }, [permission])

  const sendNotification = useCallback(
    (title: string, options?: SendNotificationOptions) => {
      if (permission === 'default') {
        setPromptOpen(true)
        toast.info(title)
        return
      }

      if (permission !== 'granted') {
        toast.info(title)
        return
      }

      // if (hasPushSubscriptions && document.visibilityState === 'hidden') return
      if (hasDevicePushSubscription) return

      const { audio, ...notificationOptions } = options || {}

      if (audio) {
        const audioElement = new Audio(audioFiles[audio])
        audioElement.volume = 0.5
        audioElement.play().catch(() => {
          console.error(`Failed to play audio: ${audioFiles[audio]}`)
        })
      }

      // Use service worker notification so clicks are handled by sw.ts
      // notificationclick handler (focus/open PWA + post NOTIFICATION_CLICK)
      navigator.serviceWorker?.ready.then(async (reg) => {
        // Close existing notification with same tag before showing new one
        // (iOS doesn't auto-replace by tag)
        if (notificationOptions.tag) {
          const existing = await reg.getNotifications({
            tag: notificationOptions.tag,
          })
          for (const n of existing) n.close()
        }
        reg.showNotification(title, {
          icon: '/icon2.png',
          ...notificationOptions,
        })
      })
    },
    [permission, hasDevicePushSubscription],
  )

  return (
    <NotificationContext.Provider
      value={{
        sendNotification,
        requestPermission,
        hasDevicePushSubscription,
      }}
    >
      {children}
      <NotificationPrompt
        open={promptOpen}
        onAllow={requestPermission}
        onDismiss={() => setPromptOpen(false)}
      />
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider')
  }
  return context
}
