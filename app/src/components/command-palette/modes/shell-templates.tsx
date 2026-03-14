import { LayoutTemplate } from 'lucide-react'
import type { AppActions, AppData } from '../createPaletteModes'
import type { PaletteAPI, PaletteLevel, PaletteMode } from '../types'

export function createShellTemplatesMode(
  data: AppData,
  _level: PaletteLevel,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const templates = data.shellTemplates ?? []

  if (templates.length === 0) {
    return {
      id: 'shell-templates',
      placeholder: 'Search templates...',
      items: [],
      emptyMessage: 'No templates saved. Create one from the shell tabs menu.',
    }
  }

  return {
    id: 'shell-templates',
    placeholder: 'Search templates...',
    items: templates.map((tmpl) => ({
      id: `template:${tmpl.id}`,
      label: tmpl.name,
      description: tmpl.entries
        .map((e) => (e.command ? `${e.name}: ${e.command}` : e.name))
        .join(' · '),
      icon: <LayoutTemplate className="h-4 w-4 shrink-0 text-zinc-400" />,
      keywords: [
        tmpl.name,
        ...tmpl.entries.map((e) => e.name),
        ...tmpl.entries.map((e) => e.command),
      ],
      onSelect: () => {
        actions.runTemplate(tmpl)
        api.close()
      },
    })),
    shouldFilter: true,
  }
}
