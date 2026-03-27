import type { CommandLog } from '@server/domains/logs/schema'
import { createContext, use } from 'react'
import { trpc } from '@/lib/trpc'

const PAGE_SIZE = 300

interface LogsContextValue {
  logs: CommandLog[]
  isLoading: boolean
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

const LogsContext = createContext<LogsContextValue | null>(null)

export function useLogsContext() {
  const ctx = use(LogsContext)
  if (!ctx) throw new Error('useLogsContext must be used within LogsProvider')
  return ctx
}

export function LogsProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.logs.infiniteList.useInfiniteQuery(
      { limit: PAGE_SIZE },
      {
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    )

  const logs = data?.pages.flatMap((p) => p.logs) ?? []

  return (
    <LogsContext
      value={{
        logs,
        isLoading,
        fetchNextPage: () => fetchNextPage(),
        hasNextPage,
        isFetchingNextPage,
      }}
    >
      {children}
    </LogsContext>
  )
}
