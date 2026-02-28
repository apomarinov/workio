import { Terminal } from 'lucide-react'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteGroup,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createCustomCommandsMode(
  data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const allActions = data.customActions
  const currentRepo = level.terminal?.git_repo?.repo
  const terminalId = level.terminal?.id

  if (allActions.length === 0) {
    return {
      id: 'custom-commands',
      placeholder: 'Search commands...',
      items: [],
      emptyMessage:
        'No custom commands. Create them from the mobile keyboard settings.',
    }
  }

  const icon = <Terminal className="h-4 w-4 shrink-0 text-zinc-400" />

  const makeItem = (ca: (typeof allActions)[number]) => ({
    id: `custom-cmd:${ca.id}`,
    label: ca.label,
    description: ca.command,
    icon,
    keywords: [ca.label, ca.command],
    onSelect: () => {
      if (terminalId != null) {
        actions.sendToTerminal(terminalId, `${ca.command}\r`)
      }
      api.close()
    },
  })

  const repoActions = currentRepo
    ? allActions
        .filter((ca) => ca.repo === currentRepo)
        .sort((a, b) => a.label.localeCompare(b.label))
    : []
  const generalActions = allActions
    .filter((ca) => !ca.repo)
    .sort((a, b) => a.label.localeCompare(b.label))

  // If only one group has items, use flat items (no groups)
  if (repoActions.length === 0 && generalActions.length > 0) {
    return {
      id: 'custom-commands',
      placeholder: 'Search commands...',
      items: generalActions.map(makeItem),
      shouldFilter: true,
    }
  }

  if (repoActions.length > 0 && generalActions.length === 0) {
    return {
      id: 'custom-commands',
      placeholder: 'Search commands...',
      items: repoActions.map(makeItem),
      shouldFilter: true,
    }
  }

  // Both groups have items — use groups
  const repoName = currentRepo?.split('/').pop() ?? currentRepo ?? ''
  const groups: PaletteGroup[] = []

  if (repoActions.length > 0) {
    groups.push({
      heading: repoName,
      items: repoActions.map(makeItem),
    })
  }
  if (generalActions.length > 0) {
    groups.push({
      heading: 'General',
      items: generalActions.map(makeItem),
    })
  }

  return {
    id: 'custom-commands',
    placeholder: 'Search commands...',
    items: [],
    groups,
    shouldFilter: true,
  }
}
