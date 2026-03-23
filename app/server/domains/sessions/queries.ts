import { publicProcedure } from '@server/trpc/init'
import { getSessionById, getSessionMessages, searchSessionMessages } from './db'
import {
  backfillCheckInput,
  getByIdInput,
  getSessionMessagesInput,
  moveTargetsInput,
  searchSessionMessagesInput,
} from './schema'
import { backfillCheck } from './services/backfill'
import { listSessionsWithFavorites } from './services/favorites'
import { getMoveTargets } from './services/move'

export const list = publicProcedure.query(async () => {
  return listSessionsWithFavorites()
})

export const getById = publicProcedure
  .input(getByIdInput)
  .query(async ({ input }) => {
    const session = await getSessionById(input.id)
    if (!session) {
      throw new Error('Session not found')
    }
    return session
  })

export const messages = publicProcedure
  .input(getSessionMessagesInput)
  .query(async ({ input }) => {
    return getSessionMessages(input.id, input.limit, input.offset)
  })

export const search = publicProcedure
  .input(searchSessionMessagesInput)
  .query(async ({ input }) => {
    const hasTextQuery = input.q != null && input.q.length >= 2
    const hasFilter = input.repo != null && input.branch != null

    if (!hasTextQuery && !hasFilter) {
      return []
    }

    return searchSessionMessages(
      hasTextQuery ? input.q : null,
      100,
      hasFilter ? { repo: input.repo!, branch: input.branch! } : undefined,
      input.recentOnly,
    )
  })

export const backfillCheckQuery = publicProcedure
  .input(backfillCheckInput)
  .query(async ({ input }) => {
    return backfillCheck(input.weeksBack)
  })

export const moveTargets = publicProcedure
  .input(moveTargetsInput)
  .query(async ({ input }) => {
    return getMoveTargets(input.id)
  })
