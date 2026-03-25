import { resolveNotification } from '@domains/notifications/registry'
import type { HookEvent } from '@domains/sessions/schema'
import { useEffect } from 'react'
import { useNotifications } from '@/context/NotificationContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useSocket } from './useSocket'

export function useNotificationSubscriptions() {
  const { terminals, selectTerminal, setShell } = useWorkspaceContext()
  const { subscribe, emit } = useSocket()
  const { sendNotification, hasDevicePushSubscription } = useNotifications()

  // Subscribe to hook events for Stop notifications
  useEffect(() => {
    return subscribe<HookEvent>('hook', (data) => {
      if (data.hook_type === 'Stop') {
        const terminal = terminals.find(
          (t) => t.id === data.terminal_id || t.cwd === data.project_path,
        )
        const terminalName =
          terminal?.name || terminal?.cwd || data.project_path || 'Terminal'
        const resolved = resolveNotification('stop', {
          terminalName,
          lastMessage: data.last_message || '',
        })
        sendNotification(`${resolved.emoji} ${resolved.title}`, {
          body: resolved.body,
          audio: resolved.audio,
          data: {
            type: 'stop',
            terminalId: terminal?.id ?? data.terminal_id,
            shellId: data.shell_id,
            sessionId: data.session_id,
          },
          tag: data.session_id ? `session:${data.session_id}` : undefined,
        })
      }
    })
  }, [subscribe, sendNotification, terminals])

  // Subscribe to enriched permission notifications (delayed after buffer scan)
  useEffect(() => {
    return subscribe<{
      session_id: string
      shell_id: number
      terminal_id: number
      project_path: string
      userMessage: string
      permissionDetail: string
    }>('permission_notification', (data) => {
      const resolved = resolveNotification('permission_needed', {
        userMessage: data.userMessage,
        permissionDetail: data.permissionDetail,
      })
      sendNotification(`${resolved.emoji} ${resolved.title}`, {
        body: resolved.body,
        audio: resolved.audio,
        data: {
          type: 'permission_needed',
          terminalId: data.terminal_id,
          shellId: data.shell_id,
          sessionId: data.session_id,
        },
        tag: data.session_id ? `session:${data.session_id}` : undefined,
      })
    })
  }, [subscribe, sendNotification])

  // Handle push notification clicks from service worker
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'NOTIFICATION_CLICK') return
      const data = event.data.data as Record<string, unknown> | undefined
      if (!data) return

      const terminalId = data.terminalId as number | undefined
      const shellId = data.shellId as number | undefined
      const terminal = terminalId
        ? terminals.find((t) => t.id === terminalId)
        : undefined

      if (terminal && shellId) {
        selectTerminal(terminal.id)
        setShell(terminal.id, shellId)
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId: terminal.id, shellId },
          }),
        )
      } else if (terminal) {
        selectTerminal(terminal.id)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () =>
      navigator.serviceWorker?.removeEventListener('message', handler)
  }, [terminals, selectTerminal, setShell])

  // Desktop (non-push) clients report activity so the server suppresses
  // push notifications while the user is at their main device.
  useEffect(() => {
    if (hasDevicePushSubscription) return

    let lastEmit = 0
    const THROTTLE_MS = 50_000
    const handler = () => {
      const now = Date.now()
      if (now - lastEmit > THROTTLE_MS) {
        lastEmit = now
        emit('desktop:active')
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (
        e.key === 'Shift' ||
        e.key === 'Control' ||
        e.key === 'Alt' ||
        e.key === 'Meta'
      )
        return
      handler()
    }
    window.addEventListener('mousemove', handler)
    window.addEventListener('keydown', keyHandler, true)
    window.addEventListener('terminal-activity', handler)
    emit('desktop:active')
    return () => {
      window.removeEventListener('mousemove', handler)
      window.removeEventListener('keydown', keyHandler, true)
      window.removeEventListener('terminal-activity', handler)
    }
  }, [emit, hasDevicePushSubscription])
}
