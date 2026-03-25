import { router } from '@server/trpc'
import * as mutations from './mutations'
import * as queries from './queries'

export const notificationsRouter = router({
  ...queries,
  ...mutations,
})
