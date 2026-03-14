import { CornerDownLeft, Terminal as TerminalIcon } from 'lucide-react'
import type { AppActions, AppData } from '../createPaletteModes'
import { getLastPathSegment } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createShellsMode(
  data: AppData,
  _level: PaletteLevel,
  actions: AppActions,
  _api: PaletteAPI,
): PaletteMode {
  const { terminals, processes, shellPorts } = data

  const groups: { heading: string; items: PaletteItem[] }[] = []
  const needsSubheadings = terminals.length > 1

  for (const t of terminals) {
    const terminalName = t.name || getLastPathSegment(t.cwd)
    const items: PaletteItem[] = t.shells.map((shell) => {
      const isMain = shell.name === 'main'
      const shellProcesses = processes.filter((p) => p.shellId === shell.id)
      const ports = shellPorts[shell.id] ?? []
      const descParts: string[] = []
      for (const p of shellProcesses) {
        descParts.push(p.command ? `${p.name} (${p.command})` : p.name)
      }
      if (ports.length > 0) {
        descParts.push(`port ${ports.join(', ')}`)
      }
      return {
        id: `shell:${t.id}:${shell.id}`,
        label: isMain ? terminalName : shell.name,
        description: descParts.length > 0 ? descParts.join(' · ') : undefined,
        icon: <TerminalIcon className="h-4 w-4 shrink-0 text-zinc-400" />,
        keywords: [
          shell.name,
          terminalName,
          ...shellProcesses.map((p) => p.name),
        ],
        onSelect: () => actions.selectShell(t.id, shell.id),
      }
    })

    if (needsSubheadings) {
      groups.push({ heading: `Shells — ${terminalName}`, items })
    } else {
      groups.push({ heading: 'Shells', items })
    }
  }

  return {
    id: 'shells',
    placeholder: 'Filter shells...',
    items: [],
    groups,
    footer: () => (
      <span className="flex items-center gap-1.5 ml-auto">
        <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
          <CornerDownLeft className="h-3 w-3" />
        </kbd>
        to select
      </span>
    ),
  }
}
