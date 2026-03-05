import type { Server as SocketIOServer } from 'socket.io'

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
  if (excludeSocketId) {
    server.except(excludeSocketId).emit('refetch', { group })
  } else {
    server.emit('refetch', { group })
  }
}
