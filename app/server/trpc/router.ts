import { logsRouter } from '@domains/logs/router'
import { notificationsRouter } from '@domains/notifications/router'
import { settingsRouter } from '@domains/settings/router'
import { router } from './init'
import { healthRouter } from './routers/health'

export const appRouter = router({
  health: healthRouter,
  logs: logsRouter,
  notifications: notificationsRouter,
  settings: settingsRouter,
})

export type AppRouter = typeof appRouter
