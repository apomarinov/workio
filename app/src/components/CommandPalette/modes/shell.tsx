import { FolderOpen } from 'lucide-react'
import type { AppActions, AppData } from '../createPaletteModes'
import type { PaletteAPI, PaletteLevel, PaletteMode } from '../types'

export function createShellMode(
  _data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { terminal } = level

  if (!terminal) {
    return {
      id: 'shell',
      placeholder: 'Filter actions...',
      items: [],
    }
  }

  return {
    id: 'shell',
    placeholder: 'Filter actions...',
    items: [
      {
        id: 'shell:select-files',
        label: 'Select Files',
        icon: <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => {
          actions.openFilePicker(terminal)
          api.close()
        },
      },
    ],
  }
}
