import { SessionStatusIcon } from '@/components/icons'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

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

  const matching = data.sessions.filter(
    (s) =>
      s.data?.branch === branchName ||
      s.data?.branches?.some((e) => e.branch === branchName),
  )

  const items: PaletteItem[] = matching.map((s) => ({
    id: `bs:${s.session_id}`,
    label: s.name || s.latest_user_message || `Untitled in "${s.project_path}"`,
    description: s.latest_agent_message && (
      <span className="truncate">{s.latest_agent_message}</span>
    ),
    icon: <SessionStatusIcon status={s.status} className="h-4 w-4" />,
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
