import { useCallback, useEffect, useState } from 'react'

export function useBrowserNotification() {
  const [permission, setPermission] =
    useState<NotificationPermission>('default')

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'denied'
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }, [])

  const notify = useCallback(
    (
      title: string,
      options?: NotificationOptions & { onClick?: () => void },
    ) => {
      if (permission !== 'granted') return null

      const notification = new Notification(title, options)

      if (options?.onClick) {
        notification.onclick = () => {
          window.focus()
          options.onClick?.()
          notification.close()
        }
      }

      return notification
    },
    [permission],
  )

  return { permission, requestPermission, notify }
}
