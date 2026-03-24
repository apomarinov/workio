import { router } from '@server/trpc/init'
import * as branchMutations from './mutations/branches'
import * as commitMutations from './mutations/commit'
import * as branchQueries from './queries/branches'
import * as diffQueries from './queries/diff'

const branchesRouter = router({
  ...branchQueries,
  ...branchMutations,
})

const diffRouter = router({
  ...diffQueries,
})

const commitRouter = router({
  ...commitMutations,
})

export const gitRouter = router({
  branches: branchesRouter,
  commit: commitRouter,
  diff: diffRouter,
})
