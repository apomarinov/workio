import type { AppRouter } from '@server/router'
import { createTRPCClient, httpLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import { getSocketId } from '@/hooks/useSocket'

function socketHeaders() {
  const id = getSocketId()
  return id ? { 'x-socket-id': id } : {}
}

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: '/api/trpc',
      headers: socketHeaders,
    }),
  ],
})

/** Vanilla tRPC client for imperative (non-hook) calls */
export const api = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: '/api/trpc',
      headers: socketHeaders,
    }),
  ],
})
