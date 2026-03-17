import { router } from '../../trpc/init'
import * as mutations from './mutations'
import * as queries from './queries'

export const settingsRouter = router({
  ...queries,
  ...mutations,
})
