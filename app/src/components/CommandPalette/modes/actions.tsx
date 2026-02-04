import {
  Copy,
  CornerDownLeft,
  GitFork,
  GitPullRequest,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'

function CursorIcon({ className }: { className?: string }) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 24 24"
      className={className}
    >
      <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
    </svg>
  )
}

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

    const items: PaletteItem[] = []

    // Open in Cursor (non-SSH only)
    if (!terminal.ssh_host) {
      items.push({
        id: 'action:cursor',
        label: 'Open in Cursor',
        icon: <CursorIcon className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.openInCursor(terminal),
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
