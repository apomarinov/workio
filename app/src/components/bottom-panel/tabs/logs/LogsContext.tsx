import type { CommandLog } from '@server/domains/logs/schema'
import { createContext, use, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { useBottomPanelContext } from '@/context/BottomPanelContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useSocket } from '@/hooks/useSocket'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'

const PAGE_SIZE = 300

interface LogsFilters {
  search: string
  source: string
  category: string | undefined
}

interface LogsContextValue {
  logs: CommandLog[]
  isLoading: boolean
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  filters: LogsFilters
  setSearch: (search: string) => void
  setSource: (source: string) => void
  setCategory: (category: string | undefined) => void
  deleteFiltered: () => Promise<void>
}

const LogsContext = createContext<LogsContextValue | null>(null)

export function useLogsContext() {
  const ctx = use(LogsContext)
  if (!ctx) throw new Error('useLogsContext must be used within LogsProvider')
  return ctx
}

function parseSource(
  source: string,
  activeTerminalId: number | undefined,
): { system?: true; terminalId?: number; prName?: string } {
  if (source === 'system') return { system: true }
  if (source === 'project') return { terminalId: activeTerminalId }
  if (source.startsWith('terminal:'))
    return { terminalId: Number(source.slice(9)) }
  if (source.startsWith('pr:')) return { prName: source.slice(3) }
  return {}
}

export function LogsProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useSocket()
  const { activeTerminal } = useWorkspaceContext()
  const { logsFilter, clearLogsFilter } = useBottomPanelContext()
  const [realtimeLogs, setRealtimeLogs] = useState<CommandLog[]>([])

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [source, setSource] = useState('project')
  const [category, setCategory] = useState<string | undefined>()

  // Apply initial filter from open-logs event
  useEffect(() => {
    if (logsFilter) {
      if (logsFilter.terminalId) {
        setSource(`terminal:${logsFilter.terminalId}`)
      } else if (logsFilter.prName) {
        setSource(`pr:${logsFilter.prName}`)
      }
      clearLogsFilter()
    }
  }, [logsFilter, clearLogsFilter])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Build query input from filters
  const sourceFilter = parseSource(source, activeTerminal?.id ?? undefined)
  const queryInput = {
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    category,
    ...sourceFilter,
  }

  const prevInputRef = useRef(queryInput)

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.logs.infiniteList.useInfiniteQuery(queryInput, {
      initialCursor: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    })

  // Clear realtime logs when filters change
  useEffect(() => {
    const prev = prevInputRef.current
    if (
      prev.search !== queryInput.search ||
      prev.category !== queryInput.category ||
      prev.system !== queryInput.system ||
      prev.terminalId !== queryInput.terminalId ||
      prev.prName !== queryInput.prName
    ) {
      setRealtimeLogs([])
    }
    prevInputRef.current = queryInput
  })

  useEffect(() => {
    return subscribe<CommandLog>('log:created', (log) => {
      setRealtimeLogs((prev) => [log, ...prev])
    })
  }, [subscribe])

  const utils = trpc.useUtils()
  const deleteMutation = trpc.logs.deleteFiltered.useMutation()

  const deleteFiltered = async () => {
    try {
      const result = await deleteMutation.mutateAsync(queryInput)
      const deletedSet = new Set(result.deletedIds)
      setRealtimeLogs((prev) => prev.filter((log) => !deletedSet.has(log.id)))
      utils.logs.infiniteList.invalidate()
      toast.success(`Deleted ${result.deletedIds.length} logs`)
    } catch (err) {
      toastError(err, 'Failed to delete logs')
    }
  }

  const queryLogs = data?.pages.flatMap((p) => p.logs) ?? []
  const logs = [
    ...realtimeLogs.filter((log) => matchesFilters(log, queryInput)),
    ...queryLogs,
  ]

  return (
    <LogsContext
      value={{
        logs,
        isLoading,
        fetchNextPage: () => fetchNextPage(),
        hasNextPage,
        isFetchingNextPage,
        filters: { search, source, category },
        setSearch,
        setSource,
        setCategory,
        deleteFiltered,
      }}
    >
      {children}
    </LogsContext>
  )
}

function matchesFilters(
  log: CommandLog,
  filters: {
    search?: string
    category?: string
    system?: boolean
    terminalId?: number
    prName?: string
  },
): boolean {
  if (filters.category && log.category !== filters.category) return false
  if (filters.system && log.terminal_id !== null) return false
  if (filters.terminalId && log.terminal_id !== filters.terminalId) return false
  if (filters.prName && log.pr_id !== filters.prName) return false
  if (
    filters.search &&
    !log.data.command.toLowerCase().includes(filters.search.toLowerCase())
  )
    return false
  return true
}
