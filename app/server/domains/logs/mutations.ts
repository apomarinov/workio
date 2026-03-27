import { publicProcedure } from '@server/trpc'
import { deleteLogs } from './db'
import { infiniteListInput } from './schema'

export const deleteFiltered = publicProcedure
  .input(infiniteListInput)
  .mutation(({ input }) => deleteLogs({ ...input, cursor: undefined }))
