import { router } from '@server/trpc'
import * as queries from './queries'

export const logsRouter = router({
  ...queries,
})
