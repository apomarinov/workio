import { GitBranch, HeartOff } from 'lucide-react'
import { SessionStatusIcon } from '@/components/icons'
import type { AppActions, AppData } from '../createPaletteModes'
import { ItemActions } from '../ItemActions'
import type {
  PaletteAPI,
  PaletteGroup,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createFavoriteSessionsMode(
  data: AppData,
  _level: PaletteLevel,
  actions: AppActions,
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
      icon: <SessionStatusIcon status={s.status} className="h-4 w-4" />,
      rightSlot: (
        <ItemActions
          actions={[
            {
              icon: <HeartOff className="h-3.5 w-3.5 text-zinc-500" />,
              onClick: () => actions.toggleFavoriteSession(s.session_id),
            },
          ]}
        />
      ),
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
