import { Bot, Check } from 'lucide-react'
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

function SessionSearchIcon({ status }: { status: string }) {
  if (status === 'done')
    return <Check className="h-4 w-4 shrink-0 text-green-500/70" />
  return (
    <Bot
      className={cn(
        'h-4 w-4 shrink-0',
        sessionStatusColor[status] ?? 'text-gray-400',
      )}
    />
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

export function createSessionSearchMode(
  data: AppData,
  _level: PaletteLevel,
  _actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { sessionSearchResults, sessionSearchLoading } = data

  if (sessionSearchLoading) {
    return {
      id: 'session-search',
      placeholder: 'Search session messages...',
      items: [],
      loading: true,
      shouldFilter: false,
      width: 'wide',
    }
  }

  if (!sessionSearchResults || sessionSearchResults.length === 0) {
    return {
      id: 'session-search',
      placeholder: 'Search session messages...',
      items: [],
      shouldFilter: false,
      width: 'wide',
      emptyMessage: 'Type to search across all session messages',
    }
  }

  const groups: PaletteGroup[] = sessionSearchResults.map((match) => {
    const heading =
      match.terminal_name ?? match.name ?? match.session_id.slice(0, 12)

    const items = [
      // Selectable session item
      {
        id: `session-search:${match.session_id}`,
        label: match.name || match.session_id.slice(0, 12),
        description: (
          <span className="truncate text-zinc-500">
            {match.project_path.split('/').pop()}
          </span>
        ),
        icon: <SessionSearchIcon status={match.status} />,
        onSelect: () => {
          api.push({
            mode: 'actions',
            title: match.name || match.session_id.slice(0, 12),
            session: {
              session_id: match.session_id,
              name: match.name,
              project_path: match.project_path,
              status: match.status as 'active',
              project_id: 0,
              terminal_id: null,
              message_count: null,
              transcript_path: null,
              created_at: '',
              updated_at: '',
              latest_user_message: null,
              latest_agent_message: null,
            },
          })
        },
      },
      // Message preview items (disabled, skipped in keyboard nav)
      ...match.messages.map((msg, i) => ({
        id: `session-search:${match.session_id}:msg:${i}`,
        label: `${msg.is_user ? 'User' : 'Claude'}: ${truncate(msg.body, 120)}`,
        disabled: true,
        onSelect: () => {},
      })),
    ]

    return { heading, items }
  })

  return {
    id: 'session-search',
    placeholder: 'Search session messages...',
    items: [],
    groups,
    shouldFilter: false,
    width: 'wide',
    emptyMessage: 'No matching sessions found',
  }
}
