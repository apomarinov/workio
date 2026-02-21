import { AlertTriangle, Bot, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
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

export function createBranchClaudeSessionsMode(
  data: AppData,
  level: PaletteLevel,
  _actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const branchName = level.branch?.name
  if (!branchName) {
    return {
      id: 'branch-claude-sessions',
      placeholder: 'Filter sessions...',
      items: [],
      emptyMessage: 'No branch selected',
    }
  }

  const matching = data.sessions.filter((s) => s.data?.branch === branchName)

  const items: PaletteItem[] = matching.map((s) => ({
    id: `bs:${s.session_id}`,
    label: s.name || s.latest_user_message || `Untitled in "${s.project_path}"`,
    description: s.latest_agent_message && (
      <span className="truncate">{s.latest_agent_message}</span>
    ),
    icon: <SessionIcon status={s.status} />,
    keywords: [
      s.name ?? '',
      s.latest_user_message ?? '',
      s.latest_agent_message ?? '',
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
  }))

  return {
    id: 'branch-claude-sessions',
    placeholder: 'Filter sessions...',
    items,
    emptyMessage: `No sessions on branch "${branchName}"`,
  }
}
