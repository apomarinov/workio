import { router } from '@server/trpc/init'
import * as shellMutations from './mutations/shells'
import * as terminalMutations from './mutations/terminals'
import * as terminalQueries from './queries/terminals'

export const workspaceRouter = router({
  terminals: router({
    ...terminalQueries,
    ...terminalMutations,
  }),
  shells: router({
    ...shellMutations,
  }),
})
