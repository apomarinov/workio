import { router } from '@server/trpc/init'
import * as queries from './queries'

export const logsRouter = router({
  ...queries,
})
