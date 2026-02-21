import {
  ClipboardCopy,
  Copy,
  CornerDownLeft,
  Eye,
  FolderOutput,
  GitBranch,
  GitFork,
  GitPullRequest,
  Heart,
  HeartOff,
  Pencil,
  Pin,
  PinOff,
  Play,
  ScrollText,
  Trash2,
} from 'lucide-react'
import { toast } from '@/components/ui/sonner'
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
  const { terminal, pr } = level
  const { pinnedTerminalSessions, pinnedSessions } = data
  // Look up fresh session from data to reflect latest state (e.g. after favorite toggle)
  const session = level.session
    ? (data.sessions.find((s) => s.session_id === level.session!.session_id) ??
      level.session)
    : undefined

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
      if (terminal.git_branch) {
        const branchNav = () => {
          actions.loadBranches(terminal.id)
          api.push({
            mode: 'branch-actions',
            title: terminal.git_branch!,
            terminal,
            pr,
            branchesLoading: true,
            branch: {
              name: terminal.git_branch!,
              isRemote: false,
              isCurrent: true,
            },
          })
        }
        items.push({
          id: 'action:current-branch',
          label: terminal.git_branch,
          icon: <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />,
          onSelect: branchNav,
          onNavigate: branchNav,
        })
      }

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

    // Open in Explorer (non-SSH only)
    if (!terminal.ssh_host) {
      items.push({
        id: 'action:explorer',
        label: 'Reveal in Finder',
        icon: <FinderIcon className="h-4 w-4 shrink-0 fill-zinc-400" />,
        onSelect: () => actions.openInExplorer(terminal),
      })
    }

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
        <span className="flex items-center gap-1.5 ml-auto">
          <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
            <CornerDownLeft className="h-3 w-3" />
          </kbd>
          to select
        </span>
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
      ...(session.terminal_id
        ? [
            {
              id: 'action:resume',
              label: 'Resume',
              icon: <Play className="h-4 w-4 shrink-0 text-zinc-400" />,
              onSelect: () => actions.resumeSession(session),
            },
          ]
        : []),
      {
        id: 'action:copy-id',
        label: 'Copy ID',
        icon: <ClipboardCopy className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => {
          navigator.clipboard.writeText(session.session_id)
          toast.success('Session ID copied to clipboard')
          api.close()
        },
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
        },
      },
      {
        id: 'action:favorite',
        label: session.is_favorite ? 'Unfavorite' : 'Favorite',
        icon: session.is_favorite ? (
          <HeartOff className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <Heart className="h-4 w-4 shrink-0 text-zinc-400" />
        ),
        onSelect: () => {
          actions.toggleFavoriteSession(session.session_id)
        },
      },
      {
        id: 'action:rename',
        label: 'Rename',
        icon: <Pencil className="h-4 w-4 shrink-0 text-zinc-400" />,
        onSelect: () => actions.openRenameModal(session),
      },
      {
        id: 'action:move-to-project',
        label: 'Move To Project',
        icon: <FolderOutput className="h-4 w-4 shrink-0 text-zinc-400" />,
        disabled: session.status !== 'ended',
        disabledReason: 'Exit the session in Claude before moving',
        onSelect: () => {
          actions.loadMoveTargets(session.session_id)
          api.push({
            mode: 'move-to-project',
            title: 'Move To Project',
            session,
            moveTargetsLoading: true,
          })
        },
        onNavigate: () => {
          actions.loadMoveTargets(session.session_id)
          api.push({
            mode: 'move-to-project',
            title: 'Move To Project',
            session,
            moveTargetsLoading: true,
          })
        },
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
        <span className="flex items-center gap-1.5 ml-auto">
          <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
            <CornerDownLeft className="h-3 w-3" />
          </kbd>
          to select
        </span>
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
