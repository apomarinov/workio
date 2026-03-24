import { createTRPCClient, httpLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '../../server/trpc/router'

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: '/api/trpc',
    }),
  ],
})

/** Vanilla tRPC client for imperative (non-hook) calls */
export const api = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: '/api/trpc',
    }),
  ],
})
