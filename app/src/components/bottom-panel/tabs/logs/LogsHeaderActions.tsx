import {
  Github,
  Search,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useGitHubContext } from '@/context/GitHubContext'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { useLogsContext } from './LogsContext'

const CATEGORY_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'git', label: 'Git', color: 'bg-orange-500/20 text-orange-400' },
  {
    value: 'workspace',
    label: 'Workspace',
    color: 'bg-blue-500/20 text-blue-400',
  },
  {
    value: 'github',
    label: 'GitHub',
    color: 'bg-purple-500/20 text-purple-400',
  },
]

const triggerClass =
  '!h-5 !bg-transparent text-muted-foreground hover:text-white hover:!bg-input/30 text-[10px] border-none shadow-none px-1.5 gap-1'

export function LogsHeaderActions() {
  const { filters, setSearch, setSource, setCategory, deleteFiltered } =
    useLogsContext()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hasFilters =
    filters.search !== '' ||
    filters.source !== 'project' ||
    filters.category !== undefined

  const resetFilters = () => {
    setSearch('')
    setSource('project')
    setCategory(undefined)
  }

  const { data: terminalsData } = trpc.logs.terminals.useQuery()
  const { data: prsData } = trpc.logs.prs.useQuery()
  const terminals = terminalsData?.terminals ?? []
  const logPrIds = prsData?.prs ?? []

  // Build PR title map from GitHub context
  const { githubPRs, mergedPRs, involvedPRs } = useGitHubContext()
  const prTitleMap = new Map<string, string>()
  for (const pr of githubPRs) {
    prTitleMap.set(`${pr.repo}#${pr.prNumber}`, pr.prTitle)
  }
  for (const pr of mergedPRs) {
    prTitleMap.set(`${pr.repo}#${pr.prNumber}`, pr.prTitle)
  }
  for (const pr of involvedPRs) {
    prTitleMap.set(`${pr.repo}#${pr.prNumber}`, pr.prTitle)
  }

  // Sort: titled PRs first, then bare IDs
  const prs = [...logPrIds].sort((a, b) => {
    const aHasTitle = prTitleMap.has(a) ? 0 : 1
    const bHasTitle = prTitleMap.has(b) ? 0 : 1
    return aHasTitle - bHasTitle
  })

  return (
    <div className="flex items-center gap-1 mr-1">
      {hasFilters && (
        <button
          type="button"
          onClick={resetFilters}
          className="flex items-center justify-center w-5 h-5 text-zinc-400 hover:text-white transition-colors cursor-pointer rounded hover:bg-zinc-700/50"
          title="Reset filters"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      <div className="flex items-center relative">
        <Search className="absolute left-1.5 w-2.5 h-2.5 text-zinc-500 pointer-events-none" />
        <input
          value={filters.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          className="h-5 w-24 max-w-[300px] py-0 pl-5 pr-1.5 text-[10px] text-zinc-300 placeholder:text-zinc-600 bg-transparent border-none rounded outline-none hover:bg-input/30 focus:bg-input/30"
        />
      </div>

      {/* Source filter (scope + terminal + PR) */}
      <Select value={filters.source} onValueChange={setSource}>
        <SelectTrigger
          size="sm"
          className={cn(
            triggerClass,
            'max-w-[200px] truncate line-clamp-1 px-2 pt-0.5',
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system" className="text-xs">
            System
          </SelectItem>
          <SelectItem value="project" className="text-xs">
            This Project
          </SelectItem>

          {terminals.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Projects</SelectLabel>
                {terminals.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={`terminal:${t.id}`}
                    className="text-xs"
                  >
                    <span className="flex items-center gap-1.5">
                      <TerminalIcon className="w-3 h-3 max-w-3 text-zinc-400 shrink-0" />
                      <span className="truncate">
                        {t.name || `Terminal ${t.id}`}
                      </span>
                      {t.deleted && (
                        <span className="text-[9px] text-red-400">
                          (deleted)
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}

          {prs.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Pull Requests</SelectLabel>
                {prs.map((pr) => {
                  const title = prTitleMap.get(pr)
                  return (
                    <SelectItem key={pr} value={`pr:${pr}`} className="text-xs">
                      <span className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Github className="w-3 h-3 max-w-3 text-zinc-400 shrink-0" />
                          <span className="max-w-[300px]">
                            {title ? `${title}` : pr}
                          </span>
                        </div>
                        {title && (
                          <span className="text-[9px] text-muted-foreground shrink-0">
                            {pr}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      {/* Category filter */}
      <Select
        value={filters.category ?? 'all'}
        onValueChange={(v) => setCategory(v === 'all' ? undefined : v)}
      >
        <SelectTrigger size="sm" className={triggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All Categories
          </SelectItem>
          {CATEGORY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              <span
                className={cn(
                  'text-[9px] uppercase tracking-wider px-1 py-0.5 rounded',
                  opt.color,
                )}
              >
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        className="flex items-center justify-center w-5 h-5 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer rounded hover:bg-zinc-700/50"
        title="Delete filtered logs"
      >
        <Trash2 className="w-3 h-3" />
      </button>

      <ConfirmModal
        open={confirmDelete}
        title="Delete logs"
        message="This will permanently delete all logs matching the current filters."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          await deleteFiltered()
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
