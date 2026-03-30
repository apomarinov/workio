import { Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { type LogsScope, useLogsContext } from './LogsContext'

const SCOPE_OPTIONS: { value: LogsScope; label: string }[] = [
  { value: 'all', label: 'All Logs' },
  { value: 'system', label: 'System Logs' },
  { value: 'project', label: 'Project Logs' },
]

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
  const { filters, setSearch, setScope, setCategory, deleteFiltered } =
    useLogsContext()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hasFilters =
    filters.search !== '' ||
    filters.scope !== 'project' ||
    filters.category !== undefined

  const resetFilters = () => {
    setSearch('')
    setScope('project')
    setCategory(undefined)
  }

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

      <Select
        value={filters.scope}
        onValueChange={(v) => setScope(v as LogsScope)}
      >
        <SelectTrigger size="sm" className={triggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCOPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
