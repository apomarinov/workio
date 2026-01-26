import { useCallback, useEffect, useRef, useState } from 'react'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface UseTerminalSocketOptions {
  terminalId: number | null
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

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000] // Exponential backoff
const MAX_RECONNECT_ATTEMPTS = 10

export function useTerminalSocket({
  terminalId,
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
  const initializedRef = useRef(false)
  const isConnectingRef = useRef(false)
  const mountedRef = useRef(true)

  // Store current values in refs
  const terminalIdRef = useRef<number | null>(terminalId)
  const colsRef = useRef(cols)
  const rowsRef = useRef(rows)
  const onDataRef = useRef(onData)
  const onExitRef = useRef(onExit)
  const onReadyRef = useRef(onReady)

  // Keep refs in sync
  useEffect(() => {
    terminalIdRef.current = terminalId
  }, [terminalId])

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
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (isConnectingRef.current) return
    if (terminalIdRef.current === null) return

    // Check max retries
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('error')
      return
    }

    cleanup()
    isConnectingRef.current = true
    setStatus('connecting')

    const currentTerminalId = terminalIdRef.current
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current || wsRef.current !== ws) return
        reconnectAttemptRef.current = 0
        ws.send(
          JSON.stringify({
            type: 'init',
            terminalId: currentTerminalId,
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
              console.error('[ws] Server error:', message.message)
              setStatus('error')
              break
          }
        } catch (err) {
          console.error('[ws] Failed to parse message:', err)
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        if (wsRef.current !== ws) return

        wsRef.current = null
        isConnectingRef.current = false
        initializedRef.current = false
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

  // Connect when terminalId changes
  useEffect(() => {
    if (terminalId !== null) {
      reconnectAttemptRef.current = 0
      connect()
    } else {
      cleanup()
      setStatus('disconnected')
    }

    return cleanup
  }, [terminalId, connect, cleanup])

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
