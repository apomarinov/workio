import { publicProcedure } from '@server/trpc/init'
import { getSessionById } from './db'
import { getByIdInput } from './schema'
import { listSessionsWithFavorites } from './services/favorites'

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
