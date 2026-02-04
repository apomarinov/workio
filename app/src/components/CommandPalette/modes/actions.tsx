import {
  Copy,
  CornerDownLeft,
  ExternalLink,
  Eye,
  FolderOpen,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { AppActions, AppData, ModeState } from '../createPaletteModes'
import { getLastPathSegment } from '../createPaletteModes'
import type { PaletteAPI, PaletteItem, PaletteMode } from '../types'

export function createActionsMode(
  data: AppData,
  state: ModeState,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { terminal, session, pr } = state
  const { pinnedTerminalSessions, pinnedSessions } = data

  // If no target, return empty mode
  if (!terminal && !session) {
    return {
      id: 'actions',
      breadcrumbs: [],
      placeholder: 'Filter actions...',
      items: [],
    }
  }

  // Terminal actions
  if (terminal) {
    const title = terminal.name || getLastPathSegment(terminal.cwd)
    const isPinned = pinnedTerminalSessions.includes(terminal.id)

    const items: PaletteItem[] = [
      {
        id: 'action:reveal',
        label: 'Reveal',
        icon: <Eye className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.selectTerminal(terminal.id),
      },
    ]

    // Open in Cursor (non-SSH only)
    if (!terminal.ssh_host) {
      items.push({
        id: 'action:cursor',
        label: 'Open in Cursor',
        icon: <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.openInCursor(terminal),
      })
    }

    // Open PR if available
    if (pr) {
      items.push({
        id: 'action:open-pr',
        label: 'Open PR in new tab',
        icon: <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => {
          actions.openPR(pr)
          api.close()
        },
      })
    }

    // Branches (git repos only)
    if (terminal.git_repo) {
      items.push({
        id: 'action:branches',
        label: 'Branches',
        icon: <GitFork className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => {
          actions.loadBranches(terminal.id)
          api.navigate({ modeId: 'branches' })
        },
        onNavigate: () => {
          actions.loadBranches(terminal.id)
          api.navigate({ modeId: 'branches' })
        },
      })
    }

    // Add Workspace (git repos only)
    if (terminal.git_repo) {
      items.push({
        id: 'action:add-workspace',
        label: 'Add Workspace',
        icon: <Copy className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.addWorkspace(terminal),
      })
    }

    // Pin/Unpin
    items.push({
      id: 'action:pin',
      label: isPinned ? 'Unpin Latest Claude' : 'Pin Latest Claude',
      icon: isPinned ? (
        <PinOff className="h-4 w-4 shrink-0 text-zinc-400" />
      ) : (
        <Pin className="h-4 w-4 shrink-0 text-zinc-400" />
      ),
      onSelect: () => {
        actions.toggleTerminalPin(terminal.id)
        api.close()
      },
    })

    // Edit
    items.push({
      id: 'action:edit',
      label: 'Edit',
      icon: <Pencil className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => actions.openEditModal(terminal),
    })

    // Delete
    items.push({
      id: 'action:delete',
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4 shrink-0 text-red-400" />,
      onSelect: () => actions.openDeleteModal(terminal),
    })

    return {
      id: 'actions',
      breadcrumbs: [title],
      placeholder: 'Filter actions...',
      items,
      onBack: () => ({
        modeId: 'search',
        highlightedId: `t:${terminal.id}`,
      }),
      footer: () => (
        <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
            to select
          </span>
        </div>
      ),
    }
  }

  // Session actions
  if (session) {
    const title =
      session.name || session.latest_user_message || session.session_id
    const isPinned = pinnedSessions.includes(session.session_id)

    const items: PaletteItem[] = [
      {
        id: 'action:reveal',
        label: 'Reveal',
        icon: <Eye className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.selectSession(session.session_id),
      },
      {
        id: 'action:pin',
        label: isPinned ? 'Unpin' : 'Pin',
        icon: isPinned ? (
          <PinOff className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <Pin className="h-4 w-4 shrink-0 text-zinc-400" />
        ),
        onSelect: () => {
          actions.toggleSessionPin(session.session_id)
          api.close()
        },
      },
      {
        id: 'action:rename',
        label: 'Rename',
        icon: <Pencil className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.openRenameModal(session),
      },
      {
        id: 'action:delete',
        label: 'Delete',
        icon: <Trash2 className="h-4 w-4 shrink-0 text-red-400" />,
        onSelect: () => actions.openDeleteSessionModal(session),
      },
    ]

    return {
      id: 'actions',
      breadcrumbs: [title],
      placeholder: 'Filter actions...',
      items,
      onBack: () => ({
        modeId: 'search',
        highlightedId: `s:${session.session_id}`,
      }),
      footer: () => (
        <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
            to select
          </span>
        </div>
      ),
    }
  }

  // Shouldn't reach here
  return {
    id: 'actions',
    breadcrumbs: [],
    placeholder: 'Filter actions...',
    items: [],
  }
}
