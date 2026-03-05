import type { Server as SocketIOServer } from 'socket.io'
import { log } from './logger'

let io: SocketIOServer | null = null

export function setIO(server: SocketIOServer) {
  io = server
}

export function getIO(): SocketIOServer | null {
  return io
}

export type RefetchGroup =
  | 'terminals'
  | 'sessions'
  | 'settings'
  | 'notifications'

export function broadcastRefetch(
  group: RefetchGroup,
  excludeSocketId?: string,
) {
  const server = getIO()
  if (!server) return
  const allIds = [...server.sockets.sockets.keys()]
  const recipientIds = excludeSocketId
    ? allIds.filter((id) => id !== excludeSocketId)
    : allIds
  log.info(
    { group, from: excludeSocketId ?? 'server', to: recipientIds },
    '[refetch]',
  )
  if (excludeSocketId) {
    server.except(excludeSocketId).emit('refetch', { group })
  } else {
    server.emit('refetch', { group })
  }
}
