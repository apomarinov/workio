import type { CommandLog } from '@server/domains/logs/schema'
import { format } from 'date-fns'
import {
  AlertCircle,
  ChevronDown,
  GitBranch,
  Github,
  Loader2,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

interface LogsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialFilter?: {
    terminalId?: number
    prName?: string // "owner/repo#123" format
  }
}

type TerminalFilterValue = 'all' | 'deleted' | number

export function LogsModal({
  open,
  onOpenChange,
  initialFilter,
}: LogsModalProps) {
  const [logs, setLogs] = useState<CommandLog[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Filter state
  const [terminalFilter, setTerminalFilter] =
    useState<TerminalFilterValue>('all')
  const [prNameFilter, setPrNameFilter] = useState<string | undefined>(
    undefined,
  )
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [failedOnly, setFailedOnly] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')

  // Track when initial filter is being applied to skip stale fetch
  const pendingInitialFilter = useRef(false)
  const offsetRef = useRef(0)

  // Build tRPC input from filter state
  const listInput = {
    terminalId: typeof terminalFilter === 'number' ? terminalFilter : undefined,
    deleted: terminalFilter === 'deleted' ? true : undefined,
    prName: prNameFilter,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    failed: failedOnly || undefined,
    startDate: dateRange?.from?.toISOString(),
    endDate: dateRange?.to?.toISOString(),
    search: searchQuery || undefined,
    offset: offsetRef.current,
    limit: 50,
  }

  const { data: terminalsData } = trpc.logs.terminals.useQuery(undefined, {
    enabled: open,
  })
  const terminals = terminalsData?.terminals ?? []

  const {
    data: logsData,
    isLoading: loading,
    isFetching,
    refetch,
  } = trpc.logs.list.useQuery(listInput, {
    enabled: open && !pendingInitialFilter.current,
  })

  // When data arrives, update local logs state (handles append for load-more)
  useEffect(() => {
    if (!logsData) return
    if (offsetRef.current > 0) {
      setLogs((prev) => [...prev, ...logsData.logs])
    } else {
      setLogs(logsData.logs)
    }
    setHasMore(logsData.hasMore)
  }, [logsData])

  // Apply initial filter when modal opens
  useEffect(() => {
    if (open && initialFilter) {
      pendingInitialFilter.current = true
      if (initialFilter.terminalId) {
        setTerminalFilter(initialFilter.terminalId)
      }
      if (initialFilter.prName) {
        setPrNameFilter(initialFilter.prName)
      }
    }
  }, [open, initialFilter])

  // When filters change, reset offset and clear pending flag
  useEffect(() => {
    if (!open) return
    if (pendingInitialFilter.current) {
      pendingInitialFilter.current = false
      return
    }
    offsetRef.current = 0
  }, [
    open,
    terminalFilter,
    prNameFilter,
    categoryFilter,
    failedOnly,
    dateRange,
    searchQuery,
  ])

  // Reset filters when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setLogs([])
        setTerminalFilter('all')
        setPrNameFilter(undefined)
        setCategoryFilter('all')
        setFailedOnly(false)
        setDateRange(undefined)
        setSearchQuery('')
        setExpandedId(null)
        setHasMore(true)
        offsetRef.current = 0
      }, 200)
    }
  }, [open])

  const loadingMore = isFetching && offsetRef.current > 0

  const loadMore = () => {
    if (!isFetching && hasMore) {
      offsetRef.current = logs.length
      refetch()
    }
  }

  // Check if pr_id is in the new "owner/repo#123" format (not old MD5 hash)
  const isReadablePrId = (prId: string | null): boolean => {
    if (!prId) return false
    return /^.+?\/.+?#\d+$/.test(prId)
  }

  // Convert pr_id "owner/repo#123" to GitHub PR URL
  const getPrUrl = (prId: string): string | null => {
    const match = prId.match(/^(.+?)\/(.+?)#(\d+)$/)
    if (!match) return null
    const [, owner, repo, prNumber] = match
    return `https://github.com/${owner}/${repo}/pull/${prNumber}`
  }

  const getEntityName = (log: CommandLog): string => {
    if (log.data.terminalName) return log.data.terminalName
    if (isReadablePrId(log.pr_id)) return log.pr_id!
    return 'System'
  }

  const getEntityIcon = (log: CommandLog) => {
    if (isReadablePrId(log.pr_id)) {
      return <Github className="w-4 h-4 text-zinc-400" />
    }
    if (log.data.terminalName) {
      return <TerminalIcon className="w-4 h-4 text-zinc-400" />
    }
    return <GitBranch className="w-4 h-4 text-zinc-400" />
  }

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      git: 'bg-orange-500/20 text-orange-400',
      workspace: 'bg-blue-500/20 text-blue-400',
      github: 'bg-purple-500/20 text-purple-400',
    }
    return (
      <span
        className={cn(
          'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded',
          colors[category] || 'bg-zinc-500/20 text-zinc-400',
        )}
      >
        {category}
      </span>
    )
  }

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'MMM d, HH:mm:ss')
    } catch {
      return dateStr
    }
  }

  const truncateCommand = (cmd: string, maxLen = 60) => {
    if (cmd.length <= maxLen) return cmd
    return `${cmd.substring(0, maxLen)}...`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col !p-3">
        <DialogHeader>
          <DialogTitle>Command Logs</DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Terminal filter */}
          <Select
            value={
              typeof terminalFilter === 'number'
                ? String(terminalFilter)
                : terminalFilter
            }
            onValueChange={(v) => {
              if (v === 'all' || v === 'deleted') {
                setTerminalFilter(v)
              } else {
                setTerminalFilter(Number(v))
              }
            }}
          >
            <SelectTrigger className="w-fit max-w-[300px]">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="deleted">
                <span className="flex items-center gap-1.5">
                  <Trash2 className="w-3 h-3" />
                  Deleted Projects
                </span>
              </SelectItem>
              {terminals.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  <span className="flex items-center gap-1.5">
                    {t.name || `Terminal ${t.id}`}
                    {t.deleted && (
                      <span className="text-[10px] text-red-400">
                        (deleted)
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category filter */}
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-fit max-w-[300px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="git">Git</SelectItem>
              <SelectItem value="workspace">Workspace</SelectItem>
              <SelectItem value="github">GitHub</SelectItem>
            </SelectContent>
          </Select>

          {/* Date range */}
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder="Date range"
            className="w-auto"
          />

          {/* Failed only checkbox */}
          <label className="flex items-center gap-2 px-2 cursor-pointer">
            <Checkbox
              checked={failedOnly}
              onCheckedChange={(checked) => setFailedOnly(checked === true)}
            />
            <span className="text-sm">Failed only</span>
          </label>
        </div>

        {/* Search */}
        <div className="pb-4 border-b border-zinc-700">
          <Input
            placeholder="Search commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Logs list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mb-2" />
              <span>No logs found</span>
            </div>
          ) : (
            <div className="space-y-1">
              {logs.map((log) => {
                const isExpanded = expandedId === log.id
                const isFailed = log.exit_code !== 0

                return (
                  <div key={log.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-sidebar-accent/50 cursor-pointer text-left',
                        isFailed && 'bg-red-500/10',
                        isExpanded && 'bg-sidebar-accent',
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform',
                          !isExpanded && '-rotate-90',
                        )}
                      />

                      {/* Date */}
                      <span className="text-xs text-muted-foreground w-32 flex-shrink-0">
                        {formatDate(log.created_at)}
                      </span>

                      {/* Category */}
                      <span className="w-20 flex-shrink-0">
                        {getCategoryBadge(log.category)}
                      </span>

                      {/* Entity */}
                      <span className="flex items-center gap-1.5 w-36 flex-shrink-0 min-w-0">
                        {getEntityIcon(log)}
                        {isReadablePrId(log.pr_id) ? (
                          <a
                            href={getPrUrl(log.pr_id!) || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs truncate text-blue-400 hover:underline"
                          >
                            {getEntityName(log)}
                          </a>
                        ) : (
                          <span className="text-xs truncate">
                            {getEntityName(log)}
                          </span>
                        )}
                      </span>

                      {/* Command */}
                      <span
                        className={cn(
                          'flex-1 text-xs font-mono truncate',
                          isFailed && 'text-red-400',
                        )}
                      >
                        {truncateCommand(log.data.command)}
                      </span>

                      {/* Exit code indicator */}
                      {isFailed && (
                        <span className="text-[10px] text-red-400 flex-shrink-0">
                          exit {log.exit_code}
                        </span>
                      )}
                    </button>

                    {/* Expanded JSON view */}
                    {isExpanded && (
                      <div className="ml-8 mr-2 my-2 p-3 bg-zinc-900 rounded border border-zinc-700 overflow-x-auto">
                        <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all">
                          {JSON.stringify(
                            {
                              id: log.id,
                              terminal_id: log.terminal_id,
                              pr_id: log.pr_id,
                              exit_code: log.exit_code,
                              category: log.category,
                              created_at: log.created_at,
                              ...log.data,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Load more */}
        {hasMore && logs.length > 0 && !loading && (
          <div className="pt-2 border-t border-zinc-700">
            <Button
              variant="outline"
              className="w-full"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                'Load More'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
