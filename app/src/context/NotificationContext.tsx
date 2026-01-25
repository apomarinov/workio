import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { NotificationPrompt } from '../components/NotificationPrompt'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

interface NotificationContextValue {
  sendNotification: (
    title: string,
    options?: NotificationOptions,
  ) => Notification | null
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
        .catch(() => {})
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
    (title: string, options?: NotificationOptions) => {
      if (permission === 'default') {
        setPromptOpen(true)
        return null
      }

      if (permission !== 'granted') {
        return null
      }

      return new Notification(title, {
        icon: '/favicon.svg',
        ...options,
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
