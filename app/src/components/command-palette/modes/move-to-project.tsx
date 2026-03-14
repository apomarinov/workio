import { FolderOutput } from 'lucide-react'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createMoveToProjectMode(
  _data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  _api: PaletteAPI,
): PaletteMode {
  const { session, moveTargets, moveTargetsLoading } = level

  if (!session) {
    return {
      id: 'move-to-project',
      placeholder: 'Select target project...',
      items: [],
    }
  }

  if (moveTargetsLoading) {
    return {
      id: 'move-to-project',
      placeholder: 'Select target project...',
      items: [],
      loading: true,
    }
  }

  if (!moveTargets) {
    return {
      id: 'move-to-project',
      placeholder: 'Select target project...',
      items: [],
      emptyMessage: 'Failed to load projects',
    }
  }

  if (moveTargets.length === 0) {
    return {
      id: 'move-to-project',
      placeholder: 'Select target project...',
      items: [],
      emptyMessage: 'No other projects available',
    }
  }

  const items: PaletteItem[] = moveTargets.map((target) => ({
    id: `move-target:${target.projectPath}`,
    label:
      target.terminalName ??
      target.projectPath.split('/').pop() ??
      target.projectPath,
    description: target.projectPath,
    icon: <FolderOutput className="h-4 w-4 shrink-0 text-zinc-400" />,
    keywords: [target.projectPath, target.terminalName ?? ''],
    onSelect: () => {
      actions.openMoveSessionModal(session, target)
    },
  }))

  return {
    id: 'move-to-project',
    placeholder: 'Select target project...',
    items,
    emptyMessage: 'No matching projects',
  }
}
