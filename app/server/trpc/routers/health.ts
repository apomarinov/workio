import { publicProcedure, router } from '../init'

export const healthRouter = router({
  check: publicProcedure.query(() => {
    return { status: 'ok' as const }
  }),
})
