import type { CommandLog } from '@server/domains/logs/schema'
import { format } from 'date-fns'
import {
  AlertCircle,
  ChevronDown,
  GitBranch,
  Github,
  Loader2,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { useState } from 'react'
import { InfiniteScrollView } from '@/components/InfiniteScrollView'
import { cn } from '@/lib/utils'
import { useLogsContext } from './LogsContext'

export function LogsView() {
  const { logs, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useLogsContext()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
        <AlertCircle className="w-5 h-5" />
        <span className="text-xs">No logs</span>
      </div>
    )
  }

  return (
    <InfiniteScrollView
      count={logs.length}
      renderItem={(index) => <LogRow key={logs[index].id} log={logs[index]} />}
      onLoadMore={() => fetchNextPage()}
      hasMore={hasNextPage}
      isLoading={isFetchingNextPage}
    />
  )
}

const cellClass = 'px-2 py-1 text-[11px] whitespace-nowrap'

function LogRow({ log }: { log: CommandLog }) {
  const { filters } = useLogsContext()
  const [expanded, setExpanded] = useState(false)
  const isFailed = log.exit_code !== 0
  const showEntity = filters.source !== 'project'

  const rowClass = cn(
    'hover:bg-sidebar-accent/50 cursor-pointer',
    isFailed && 'bg-red-500/10',
    expanded && 'bg-sidebar-accent',
  )

  return (
    <>
      <tr onClick={() => setExpanded((e) => !e)} className={rowClass}>
        <td className={cn(cellClass, 'w-0')}>
          <ChevronDown
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              !expanded && '-rotate-90',
            )}
          />
        </td>
        <td className={cn(cellClass, 'text-muted-foreground')}>
          {formatDate(log.created_at)}
        </td>
        <td className={cellClass}>{categoryBadge(log.category)}</td>
        {showEntity && (
          <td className={cellClass}>
            <span className="flex items-center gap-1">
              {entityIcon(log)}
              <span className="truncate max-w-32">{entityName(log)}</span>
            </span>
          </td>
        )}
        <td
          className={cn(
            cellClass,
            'w-full font-mono max-w-0',
            isFailed && 'text-red-400',
          )}
        >
          <span className="block truncate">{log.data.command}</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={showEntity ? 5 : 4} className="px-2 pb-1">
            <div className="ml-4 p-2 bg-zinc-900 rounded border border-zinc-700 overflow-x-auto">
              <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all">
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
          </td>
        </tr>
      )}
    </>
  )
}

function formatDate(dateStr: string) {
  try {
    return format(new Date(dateStr), 'MMM d, HH:mm:ss')
  } catch {
    return dateStr
  }
}

function categoryBadge(category: string) {
  const colors: Record<string, string> = {
    git: 'bg-orange-500/20 text-orange-400',
    workspace: 'bg-blue-500/20 text-blue-400',
    github: 'bg-purple-500/20 text-purple-400',
  }
  return (
    <span
      className={cn(
        'text-[9px] uppercase tracking-wider px-1 py-0.5 rounded',
        colors[category] || 'bg-zinc-500/20 text-zinc-400',
      )}
    >
      {category}
    </span>
  )
}

function entityName(log: CommandLog): string {
  if (log.terminal_name) return log.terminal_name
  if (log.data.terminalName) return log.data.terminalName
  if (log.pr_id && /^.+?\/.+?#\d+$/.test(log.pr_id)) return log.pr_id
  return 'System'
}

function entityIcon(log: CommandLog) {
  if (log.pr_id && /^.+?\/.+?#\d+$/.test(log.pr_id)) {
    return <Github className="w-3 h-3 text-zinc-400 flex-shrink-0" />
  }
  if (log.terminal_name || log.data.terminalName) {
    return <TerminalIcon className="w-3 h-3 text-zinc-400 flex-shrink-0" />
  }
  return <GitBranch className="w-3 h-3 text-zinc-400 flex-shrink-0" />
}
