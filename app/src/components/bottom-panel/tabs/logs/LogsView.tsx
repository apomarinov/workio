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

  // Logs come newest-first from the API.
  // InfiniteScrollView renders index 0 at the bottom (flex-col-reverse).
  // So index 0 = newest log = logs[0], which is correct.
  return (
    <InfiniteScrollView
      count={logs.length}
      renderItem={(index) => <LogRow log={logs[index]} />}
      onLoadMore={() => fetchNextPage()}
      hasMore={hasNextPage}
      isLoading={isFetchingNextPage}
    />
  )
}

function LogRow({ log }: { log: CommandLog }) {
  const [expanded, setExpanded] = useState(false)
  const isFailed = log.exit_code !== 0

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          'w-full flex items-start sm:items-center max-sm:flex-col max-sm:gap-1 gap-2 px-2 py-1 text-left hover:bg-sidebar-accent/50 cursor-pointer',
          isFailed && 'bg-red-500/10',
          expanded && 'bg-sidebar-accent',
        )}
      >
        <div className="flex items-center">
          <ChevronDown
            className={cn(
              'w-3 h-3 flex-shrink-0 text-muted-foreground transition-transform mr-1',
              !expanded && '-rotate-90',
            )}
          />
          <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">
            {formatDate(log.created_at)}
          </span>
          <span className="w-16 flex-shrink-0 flex items-center">
            {categoryBadge(log.category)}
          </span>
          <span className="flex items-center gap-1 w-28 flex-shrink-0 min-w-0">
            {entityIcon(log)}
            <span className="text-[11px] truncate">{entityName(log)}</span>
          </span>
        </div>
        <span
          className={cn(
            'flex-1 text-[11px] font-mono truncate max-w-full',
            isFailed && 'text-red-400',
          )}
        >
          {log.data.command}
        </span>
      </button>

      {expanded && (
        <div className="ml-6 mr-2 my-1 p-2 bg-zinc-900 rounded border border-zinc-700 overflow-x-auto">
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
      )}
    </div>
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
  if (log.data.terminalName) return log.data.terminalName
  if (log.pr_id && /^.+?\/.+?#\d+$/.test(log.pr_id)) return log.pr_id
  return 'System'
}

function entityIcon(log: CommandLog) {
  if (log.pr_id && /^.+?\/.+?#\d+$/.test(log.pr_id)) {
    return <Github className="w-3 h-3 text-zinc-400 flex-shrink-0" />
  }
  if (log.data.terminalName) {
    return <TerminalIcon className="w-3 h-3 text-zinc-400 flex-shrink-0" />
  }
  return <GitBranch className="w-3 h-3 text-zinc-400 flex-shrink-0" />
}
