import { initTRPC } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'

export function createContext({ req, res }: CreateFastifyContextOptions) {
  return { req, res }
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
