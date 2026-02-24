import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { NotificationPrompt } from '../components/NotificationPrompt'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

type AudioType = 'permission' | 'done' | 'pr-activity' | 'error'

const audioFiles: Record<AudioType, string> = {
  permission: '/audio/permissions.mp3',
  done: '/audio/done.mp3',
  error: '/audio/error.mp3',
  'pr-activity': '/audio/pr-noti.mp3',
}

interface SendNotificationOptions extends NotificationOptions {
  audio?: AudioType
}

interface NotificationContextValue {
  sendNotification: (title: string, options?: SendNotificationOptions) => void
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
        return
      }

      if (permission !== 'granted') {
        return
      }

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
      navigator.serviceWorker?.ready.then((reg) => {
        reg.showNotification(title, {
          icon: '/icon2.png',
          ...notificationOptions,
        })
      })
    },
    [permission],
  )

  return (
    <NotificationContext.Provider
      value={{
        sendNotification,
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
