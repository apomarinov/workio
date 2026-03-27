import { publicProcedure } from '@server/trpc'
import { getCommandLogs, getCommandLogsInfinite, getLogTerminals } from './db'
import { infiniteListInput, listInput } from './schema'

export const list = publicProcedure
  .input(listInput)
  .query(({ input }) => getCommandLogs(input))

export const infiniteList = publicProcedure
  .input(infiniteListInput)
  .query(async ({ input }) => {
    const result = await getCommandLogsInfinite(input)
    result.logs.reverse()
    return result
  })

export const terminals = publicProcedure.query(() => getLogTerminals())
