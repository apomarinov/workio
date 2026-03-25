import { gitRouter } from '@domains/git/router'
import { githubRouter } from '@domains/github/router'
import { logsRouter } from '@domains/logs/router'
import { notificationsRouter } from '@domains/notifications/router'
import { sessionsRouter } from '@domains/sessions/router'
import { settingsRouter } from '@domains/settings/router'
import { workspaceRouter } from '@domains/workspace/router'
import { router } from './trpc'

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
