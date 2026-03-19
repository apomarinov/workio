import { router } from '@server/trpc/init'
import * as setupMutations from './mutations/setup'
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
  setup: router({
    ...setupMutations,
  }),
})
