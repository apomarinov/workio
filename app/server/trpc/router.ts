import { settingsRouter } from '@domains/settings/router'
import { router } from './init'
import { healthRouter } from './routers/health'

export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
})

export type AppRouter = typeof appRouter
