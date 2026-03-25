import { publicProcedure } from '@server/trpc'
import { getCommandLogs, getLogTerminals } from './db'
import { listInput } from './schema'

export const list = publicProcedure
  .input(listInput)
  .query(({ input }) => getCommandLogs(input))

export const terminals = publicProcedure.query(() => getLogTerminals())
