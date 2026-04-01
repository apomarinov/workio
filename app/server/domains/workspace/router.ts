import { router } from '@server/trpc'
import './services/branch-rename'
import * as setupMutations from './mutations/setup'
import * as shellMutations from './mutations/shells'
import * as systemMutations from './mutations/system'
import * as terminalMutations from './mutations/terminals'
import * as systemQueries from './queries/system'
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
  system: router({
    ...systemQueries,
    ...systemMutations,
  }),
})
