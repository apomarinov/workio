import { router } from '@server/trpc/init'
import * as mutations from './mutations'
import * as queries from './queries/terminals'

export const workspaceRouter = router({
  ...queries,
  ...mutations,
})
