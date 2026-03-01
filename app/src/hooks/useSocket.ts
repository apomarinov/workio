import { useCallback, useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

// In dev, go through the Vite proxy (same origin) so HTTPS/WSS works seamlessly
const SOCKET_URL = window.location.origin

let socket: Socket | null = null
let connectionCount = 0

function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
    })
  }
  return socket
}

export function useSocket() {
  const socketRef = useRef<Socket>(getSocket())

  useEffect(() => {
    const s = socketRef.current

    connectionCount++
    if (connectionCount === 1) {
      s.connect()
    }

    const handleConnect = () => {
      // console.log('[Socket] Connected:', s.id)
    }

    const handleDisconnect = (_reason: string) => {
      // console.log('[Socket] Disconnected:', reason)
    }

    s.on('connect', handleConnect)
    s.on('disconnect', handleDisconnect)

    if (s.connected) {
      console.log('[Socket] Already connected:', s.id)
    }

    return () => {
      s.off('connect', handleConnect)
      s.off('disconnect', handleDisconnect)
      connectionCount--
      if (connectionCount === 0) {
        s.disconnect()
      }
    }
  }, [])

  const subscribe = useCallback(
    <T>(event: string, handler: (data: T) => void) => {
      const s = socketRef.current
      s.on(event, handler)
      return () => {
        s.off(event, handler)
      }
    },
    [],
  )

  const emit = useCallback(<T>(event: string, data?: T) => {
    socketRef.current.emit(event, data)
  }, [])

  return {
    socket: socketRef.current,
    subscribe,
    emit,
  }
}
