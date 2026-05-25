import { useCallback, useEffect, useRef, useState } from 'react'

type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'already_open'

interface PtyDimensions {
  cols: number
  rows: number
  fontSize?: number
}

interface UseTerminalSocketOptions {
  shellId: number | null
  cols: number
  rows: number
  fontSize: number
  isVisible: boolean
  onData: (data: string) => void
  onExit?: (code: number) => void
  onReady?: () => void
  onPrimaryChanged?: (isPrimary: boolean, ptyDims: PtyDimensions) => void
}

interface UseTerminalSocketReturn {
  status: ConnectionStatus
  sendInput: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  reconnect: () => void
  isPrimary: boolean
  ptyDimensions: PtyDimensions | null
  claimPrimary: () => void
  releasePrimary: () => void
}

const RECONNECT_DELAYS = [200, 500, 1000, 1000, 1000, 2000, 3000]
const MAX_RECONNECT_ATTEMPTS = 10

export function useTerminalSocket({
  shellId,
  cols,
  rows,
  fontSize,
  isVisible,
  onData,
  onExit,
  onReady,
  onPrimaryChanged,
}: UseTerminalSocketOptions): UseTerminalSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [isPrimary, setIsPrimary] = useState(true)
  const [ptyDimensions, setPtyDimensions] = useState<PtyDimensions | null>(null)
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
  const fontSizeRef = useRef(fontSize)
  const isVisibleRef = useRef(isVisible)
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
    fontSizeRef.current = fontSize
  }, [fontSize])

  useEffect(() => {
    isVisibleRef.current = isVisible
  }, [isVisible])

  const onPrimaryChangedRef = useRef(onPrimaryChanged)

  useEffect(() => {
    onDataRef.current = onData
    onExitRef.current = onExit
    onReadyRef.current = onReady
    onPrimaryChangedRef.current = onPrimaryChanged
  }, [onData, onExit, onReady, onPrimaryChanged])

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
        // reconnectAttemptRef is reset on 'ready' (true success). The TCP/WS
        // handshake succeeding isn't enough — the server may still reject the
        // init with `already_connected`, and resetting here would let that
        // case loop forever.
        ws.send(
          JSON.stringify({
            type: 'init',
            shellId: currentShellId,
            cols: colsRef.current,
            rows: rowsRef.current,
            fontSize: fontSizeRef.current,
            requestPrimary: isVisibleRef.current,
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
              reconnectAttemptRef.current = 0
              isConnectingRef.current = false
              initializedRef.current = true
              setStatus('connected')
              setIsPrimary(message.isPrimary ?? true)
              if (message.ptyCols != null && message.ptyRows != null) {
                const dims: PtyDimensions = {
                  cols: message.ptyCols,
                  rows: message.ptyRows,
                  fontSize: message.ptyFontSize,
                }
                setPtyDimensions(dims)
                // Sync primary/scaled state immediately so handleReady's
                // deferred callback sees the correct isPrimaryRef value.
                onPrimaryChangedRef.current?.(message.isPrimary ?? true, dims)
              }
              onReadyRef.current?.()
              break
            case 'primary-changed': {
              const primary = message.isPrimary ?? false
              const dims: PtyDimensions = {
                cols: message.ptyCols ?? 80,
                rows: message.ptyRows ?? 24,
                fontSize: message.ptyFontSize,
              }
              setIsPrimary(primary)
              setPtyDimensions(dims)
              onPrimaryChangedRef.current?.(primary, dims)
              break
            }
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
                isConnectingRef.current = false
                // Server closes the WS — onclose will schedule a delayed
                // retry so the heartbeat has time to evict any zombie that
                // owns this device slot.
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

        const wasAlreadyOpen = alreadyOpenRef.current

        // Keep the 'already_open' status visible across the wait so the user
        // sees a stable message instead of flicker to 'disconnected'.
        if (!wasAlreadyOpen) {
          setStatus('disconnected')
        }

        // Schedule reconnect with exponential backoff. For already_open
        // rejections, wait at least 5s so the server-side heartbeat (5s
        // interval) has a chance to evict the zombie WS that owns the slot.
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const baseDelay =
            RECONNECT_DELAYS[
              Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)
            ]
          const delay = wasAlreadyOpen ? Math.max(baseDelay, 5_000) : baseDelay
          reconnectAttemptRef.current++

          reconnectTimeoutRef.current = setTimeout(() => {
            alreadyOpenRef.current = false
            if (mountedRef.current) {
              connect()
            }
          }, delay)
        } else {
          alreadyOpenRef.current = false
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

  // When this shell becomes visible, claim primary so the server
  // auto-releases this client from any other shell it was primary on.
  useEffect(() => {
    if (
      isVisible &&
      wsRef.current?.readyState === WebSocket.OPEN &&
      initializedRef.current
    ) {
      wsRef.current.send(JSON.stringify({ type: 'claim-primary' }))
    }
  }, [isVisible])

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

  const claimPrimary = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      initializedRef.current
    ) {
      wsRef.current.send(JSON.stringify({ type: 'claim-primary' }))
    }
  }, [])

  const releasePrimary = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      initializedRef.current
    ) {
      wsRef.current.send(JSON.stringify({ type: 'release-primary' }))
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
    isPrimary,
    ptyDimensions,
    claimPrimary,
    releasePrimary,
  }
}
