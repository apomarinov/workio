import { AlertTriangle, Bot, Check, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteGroup,
  PaletteLevel,
  PaletteMode,
} from '../types'

const sessionStatusColor: Record<string, string> = {
  started: 'text-green-500',
  active: 'text-[#D97757]',
  done: 'text-gray-500',
  ended: 'text-gray-500',
  permission_needed: 'text-[#D97757]',
  idle: 'text-gray-400',
}

function SessionIcon({ status }: { status: string }) {
  if (status === 'done')
    return <Check className="h-4 w-4 shrink-0 text-green-500/70" />
  if (status === 'active' || status === 'permission_needed')
    return (
      <>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 300 150"
          className="h-4 w-4 shrink-0"
        >
          <path
            fill="none"
            stroke="#D97757"
            strokeWidth="40"
            strokeLinecap="round"
            strokeDasharray="300 385"
            strokeDashoffset="0"
            d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"
          >
            <animate
              attributeName="stroke-dashoffset"
              calcMode="spline"
              dur="2s"
              values="685;-685"
              keySplines="0 0 1 1"
              repeatCount="indefinite"
            />
          </path>
        </svg>
        {status === 'permission_needed' && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500 animate-pulse" />
        )}
      </>
    )
  return (
    <Bot
      className={cn(
        'h-4 w-4 shrink-0',
        sessionStatusColor[status] ?? 'text-gray-400',
      )}
    />
  )
}

export function createFavoriteSessionsMode(
  data: AppData,
  _level: PaletteLevel,
  _actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { sessions, terminals } = data
  const favorites = sessions.filter((s) => s.is_favorite)

  if (favorites.length === 0) {
    return {
      id: 'favorite-sessions',
      placeholder: 'Filter favorite sessions...',
      items: [],
      emptyMessage: 'No favorite sessions',
    }
  }

  // Build terminal name lookup
  const terminalMap = new Map(terminals.map((t) => [t.id, t]))

  // Group by terminal name
  const grouped = new Map<string, typeof favorites>()
  for (const s of favorites) {
    const terminal = s.terminal_id ? terminalMap.get(s.terminal_id) : null
    const groupName = terminal?.name || 'Not in project'
    const existing = grouped.get(groupName) || []
    existing.push(s)
    grouped.set(groupName, existing)
  }

  // Sort so terminal groups come first, "All" last
  const sortedEntries = [...grouped.entries()].sort(([a], [b]) => {
    if (a === 'Not in project') return 1
    if (b === 'Not in project') return -1
    return 0
  })

  const groups: PaletteGroup[] = sortedEntries.map(([heading, sessions]) => ({
    heading,
    items: sessions.map((s) => ({
      id: `fav:${s.session_id}`,
      label:
        s.name || s.latest_user_message || `Untitled in "${s.project_path}"`,
      description: (s.data?.branch || s.latest_agent_message) && (
        <>
          {s.latest_agent_message && (
            <span className="truncate">{s.latest_agent_message}</span>
          )}
          {s.data?.branch && (
            <span className="flex items-center gap-1 truncate">
              <GitBranch className="max-h-3 max-w-3 shrink-0 text-zinc-400" />
              {s.data.branch}
            </span>
          )}
        </>
      ),
      icon: <SessionIcon status={s.status} />,
      keywords: [
        s.name ?? '',
        s.latest_user_message ?? '',
        s.latest_agent_message ?? '',
        s.data?.branch ?? '',
      ],
      onSelect: () => {
        api.push({
          mode: 'actions',
          title: s.name || s.latest_user_message || s.session_id,
          session: s,
        })
      },
      onNavigate: () => {
        api.push({
          mode: 'actions',
          title: s.name || s.latest_user_message || s.session_id,
          session: s,
        })
      },
    })),
  }))

  return {
    id: 'favorite-sessions',
    placeholder: 'Filter favorite sessions...',
    items: [],
    groups,
    shouldFilter: true,
  }
}
