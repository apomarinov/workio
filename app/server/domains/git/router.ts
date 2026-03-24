import { router } from '@server/trpc/init'
import * as branchMutations from './mutations/branches'
import * as branchQueries from './queries/branches'
import * as diffQueries from './queries/diff'

const branchesRouter = router({
  ...branchQueries,
  ...branchMutations,
})

const diffRouter = router({
  ...diffQueries,
})

export const gitRouter = router({
  branches: branchesRouter,
  diff: diffRouter,
})
