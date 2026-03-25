import { gitRouter } from '@domains/git/router'
import { githubRouter } from '@domains/github/router'
import { logsRouter } from '@domains/logs/router'
import { notificationsRouter } from '@domains/notifications/router'
import { sessionsRouter } from '@domains/sessions/router'
import { settingsRouter } from '@domains/settings/router'
import { workspaceRouter } from '@domains/workspace/router'
import { initTRPC } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'

export function createContext({ req, res }: CreateFastifyContextOptions) {
  return { req, res }
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const appRouter = router({
  git: gitRouter,
  github: githubRouter,
  logs: logsRouter,
  notifications: notificationsRouter,
  sessions: sessionsRouter,
  settings: settingsRouter,
  workspace: workspaceRouter,
})

export type AppRouter = typeof appRouter
