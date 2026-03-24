import { router } from '@server/trpc/init'
import * as branchMutations from './mutations/branches'
import * as branchQueries from './queries/branches'

const branchesRouter = router({
  ...branchQueries,
  ...branchMutations,
})

export const gitRouter = router({
  branches: branchesRouter,
})
