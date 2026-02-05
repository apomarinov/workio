import {
  Copy,
  CornerDownLeft,
  Eye,
  GitFork,
  GitPullRequest,
  Pencil,
  Pin,
  PinOff,
  ScrollText,
  Trash2,
} from 'lucide-react'
import { CursorIcon, FinderIcon, VSCodeIcon } from '../../icons'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createActionsMode(
  data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { terminal, session, pr } = level
  const { pinnedTerminalSessions, pinnedSessions } = data

  // If no target, return empty mode
  if (!terminal && !session) {
    return {
      id: 'actions',
      placeholder: 'Filter actions...',
      items: [],
    }
  }

  // Terminal actions
  if (terminal) {
    const isPinned = pinnedTerminalSessions.includes(terminal.id)
    const { preferredIDE } = data

    const items: PaletteItem[] = []

    // Open in IDE (non-SSH only)
    if (!terminal.ssh_host) {
      const ideLabel = preferredIDE === 'vscode' ? 'VS Code' : 'Cursor'
      const ideIcon =
        preferredIDE === 'vscode' ? (
          <VSCodeIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <CursorIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        )
      items.push({
        id: 'action:ide',
        label: `Open in ${ideLabel}`,
        icon: ideIcon,
        onSelect: () => actions.openInIDE(terminal),
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
          api.push({
            mode: 'branches',
            title: 'Branches',
            terminal,
            pr,
            branchesLoading: true,
          })
        },
        onNavigate: () => {
          actions.loadBranches(terminal.id)
          api.push({
            mode: 'branches',
            title: 'Branches',
            terminal,
            pr,
            branchesLoading: true,
          })
        },
      })
    }

    // Pull Request actions (if PR exists)
    if (pr) {
      items.push({
        id: 'action:pr',
        label: 'Pull Request',
        icon: <GitPullRequest className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => {
          api.push({
            mode: 'pr-actions',
            title: pr.prTitle,
            terminal,
            pr,
          })
        },
        onNavigate: () => {
          api.push({
            mode: 'pr-actions',
            title: pr.prTitle,
            terminal,
            pr,
          })
        },
      })
    }

    // Open in Explorer (non-SSH only)
    if (!terminal.ssh_host) {
      items.push({
        id: 'action:explorer',
        label: 'Reveal in Finder',
        icon: <FinderIcon className="h-4 w-4 shrink-0 fill-zinc-400" />,
        onSelect: () => actions.openInExplorer(terminal),
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

    // View Logs
    items.push({
      id: 'action:logs',
      label: 'Logs',
      icon: <ScrollText className="h-4 w-4 shrink-0 text-zinc-400" />,
      onSelect: () => {
        window.dispatchEvent(
          new CustomEvent('open-logs', { detail: { terminalId: terminal.id } }),
        )
        api.close()
      },
    })

    return {
      id: 'actions',
      placeholder: 'Filter actions...',
      items,
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
      placeholder: 'Filter actions...',
      items,
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
    placeholder: 'Filter actions...',
    items: [],
  }
}
