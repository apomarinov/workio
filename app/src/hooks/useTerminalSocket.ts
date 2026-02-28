
import { useCallback, useEffect, useRef, useState } from 'react'

type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'already_open'

interface UseTerminalSocketOptions {
  shellId: number | null
  cols: number
  rows: number
  onData: (data: string) => void
  onExit?: (code: number) => void
  onReady?: () => void
}

interface UseTerminalSocketReturn {
  status: ConnectionStatus
  sendInput: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  reconnect: () => void
}

const RECONNECT_DELAYS = [200, 500, 1000, 2000, 4000, 8000, 16000] // Exponential backoff
const MAX_RECONNECT_ATTEMPTS = 10

export function useTerminalSocket({
  shellId,
  cols,
  rows,
  onData,
  onExit,
  onReady,
}: UseTerminalSocketOptions): UseTerminalSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)
  const isConnectingRef = useRef(false)
  const mountedRef = useRef(true)
  const alreadyOpenRef = useRef(false)

  // Store current values in refs
  const shellIdRef = useRef<number | null>(shellId)
  const colsRef = useRef(cols)
  const rowsRef = useRef(rows)
  const onDataRef = useRef(onData)
  const onExitRef = useRef(onExit)
  const onReadyRef = useRef(onReady)

  // Keep refs in sync
  useEffect(() => {
    shellIdRef.current = shellId
  }, [shellId])

  useEffect(() => {
    colsRef.current = cols
    rowsRef.current = rows
  }, [cols, rows])

  useEffect(() => {
    onDataRef.current = onData
    onExitRef.current = onExit
    onReadyRef.current = onReady
  }, [onData, onExit, onReady])

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const cleanup = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      const ws = wsRef.current
      wsRef.current = null
      // Remove handlers first to prevent any callbacks during close
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      // Only close if not already closing/closed
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close()
      }
    }
    isConnectingRef.current = false
    initializedRef.current = false
    alreadyOpenRef.current = false
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (isConnectingRef.current) return
    if (shellIdRef.current === null) return

    // Don't connect when page is hidden (e.g. PWA woken in background by push notification).
    // The visibilitychange listener will call connect() when the page becomes visible.
    if (document.visibilityState === 'hidden') return

    // Check max retries
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('error')
      return
    }

    cleanup()
    isConnectingRef.current = true
    setStatus('connecting')

    const currentShellId = shellIdRef.current
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      // Timeout: if we don't reach 'connected' within 10s, force retry
      connectTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || !isConnectingRef.current) return
        console.warn('[ws] Connection timeout, forcing retry')
        cleanup()
        setStatus('disconnected')
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay =
            RECONNECT_DELAYS[
            Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)
            ]
          reconnectAttemptRef.current++
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        } else {
          setStatus('error')
        }
      }, 10_000)

      ws.onopen = () => {
        if (!mountedRef.current || wsRef.current !== ws) return
        reconnectAttemptRef.current = 0
        ws.send(
          JSON.stringify({
            type: 'init',
            shellId: currentShellId,
            cols: colsRef.current,
            rows: rowsRef.current,
          }),
        )
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current || wsRef.current !== ws) return
        try {
          const message = JSON.parse(event.data)
          switch (message.type) {
            case 'ready':
              if (connectTimeoutRef.current) {
                clearTimeout(connectTimeoutRef.current)
                connectTimeoutRef.current = null
              }
              isConnectingRef.current = false
              initializedRef.current = true
              setStatus('connected')
              onReadyRef.current?.()
              break
            case 'output':
              onDataRef.current(message.data)
              break
            case 'exit':
              onExitRef.current?.(message.code)
              break
            case 'error':
              if (message.code === 'already_connected') {
                alreadyOpenRef.current = true
                setStatus('already_open')
                if (connectTimeoutRef.current) {
                  clearTimeout(connectTimeoutRef.current)
                  connectTimeoutRef.current = null
                }
                if (reconnectTimeoutRef.current) {
                  clearTimeout(reconnectTimeoutRef.current)
                  reconnectTimeoutRef.current = null
                }
                isConnectingRef.current = false
                // Server will close the WS; no need to call ws.close()
              } else {
                console.error('[ws] Server error:', message.message)
                setStatus('error')
              }
              break
          }
        } catch (err) {
          console.error('[ws] Failed to parse message:', err)
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        if (wsRef.current !== ws) return

        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        wsRef.current = null
        isConnectingRef.current = false
        initializedRef.current = false

        // Don't reconnect or change status if rejected as duplicate
        if (alreadyOpenRef.current) return

        setStatus('disconnected')

        // Schedule reconnect with exponential backoff
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay =
            RECONNECT_DELAYS[
            Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)
            ]
          reconnectAttemptRef.current++

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect()
            }
          }, delay)
        } else {
          setStatus('error')
        }
      }

      ws.onerror = () => {
        // onerror is always followed by onclose, so we handle reconnection there
      }
    } catch (err) {
      console.error('[ws] Failed to create WebSocket:', err)
      isConnectingRef.current = false
      setStatus('error')
    }
  }, [cleanup])

  // Connect when shellId changes
  useEffect(() => {
    if (shellId !== null) {
      reconnectAttemptRef.current = 0
      connect()
    } else {
      cleanup()
      setStatus('disconnected')
    }

    return cleanup
  }, [shellId, connect, cleanup])

  // When page becomes visible, connect if we should be connected but aren't
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        shellIdRef.current !== null &&
        !wsRef.current &&
        !isConnectingRef.current &&
        !alreadyOpenRef.current
      ) {
        reconnectAttemptRef.current = 0
        connect()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [connect])

  const sendInput = useCallback((data: string) => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      initializedRef.current
    ) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }))
    }
  }, [])

  const sendResize = useCallback((newCols: number, newRows: number) => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      initializedRef.current
    ) {
      wsRef.current.send(
        JSON.stringify({ type: 'resize', cols: newCols, rows: newRows }),
      )
    }
  }, [])

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0
    connect()
  }, [connect])

  return {
    status,
    sendInput,
    sendResize,
    reconnect,
  }
}
