import { publicProcedure } from '@server/trpc/init'
import { deleteSession, deleteSessions, updateSession } from './db'
import {
  bulkDeleteSessionsInput,
  cleanupSessionsInput,
  deleteSessionInput,
  toggleFavoriteInput,
  updateSessionInput,
} from './schema'
import { cleanupOldSessions, toggleFavorite } from './services/favorites'

export const update = publicProcedure
  .input(updateSessionInput)
  .mutation(async ({ input }) => {
    const updated = await updateSession(input.id, { name: input.name })
    if (!updated) {
      throw new Error('Session not found')
    }
  })

export const remove = publicProcedure
  .input(deleteSessionInput)
  .mutation(async ({ input }) => {
    const deleted = await deleteSession(input.id)
    if (!deleted) {
      throw new Error('Session not found')
    }
  })

export const bulkDelete = publicProcedure
  .input(bulkDeleteSessionsInput)
  .mutation(async ({ input }) => {
    await deleteSessions(input.ids)
  })

export const sessionToggleFavorite = publicProcedure
  .input(toggleFavoriteInput)
  .mutation(async ({ input }) => {
    return toggleFavorite(input.id)
  })

export const cleanup = publicProcedure
  .input(cleanupSessionsInput)
  .mutation(async ({ input }) => {
    return cleanupOldSessions(input.weeks)
  })
