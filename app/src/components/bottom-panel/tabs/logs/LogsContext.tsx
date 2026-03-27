import type { CommandLog } from '@server/domains/logs/schema'
import { createContext, use, useEffect, useState } from 'react'
import { useSocket } from '@/hooks/useSocket'
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
  const { subscribe } = useSocket()
  const [realtimeLogs, setRealtimeLogs] = useState<CommandLog[]>([])

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.logs.infiniteList.useInfiniteQuery(
      { limit: PAGE_SIZE },
      {
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    )

  useEffect(() => {
    return subscribe<CommandLog>('log:created', (log) => {
      setRealtimeLogs((prev) => [log, ...prev])
    })
  }, [subscribe])

  const queryLogs = data?.pages.flatMap((p) => p.logs) ?? []
  const logs = [...realtimeLogs, ...queryLogs]

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
