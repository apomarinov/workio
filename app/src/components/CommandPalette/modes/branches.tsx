import {
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownLeft,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  Trash2,
} from 'lucide-react'
import type { AppActions, AppData } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createBranchesMode(
  _data: AppData,
  level: PaletteLevel,
  _actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { terminal, pr, branches, branchesLoading } = level

  if (!terminal) {
    return {
      id: 'branches',
      placeholder: 'Filter branches...',
      items: [],
    }
  }

  // If loading, show loading state
  if (branchesLoading) {
    return {
      id: 'branches',
      placeholder: 'Filter branches...',
      items: [],
      loading: true,
    }
  }

  // If no branches loaded yet or failed
  if (!branches) {
    return {
      id: 'branches',
      placeholder: 'Filter branches...',
      items: [],
      emptyMessage: 'Failed to load branches',
    }
  }

  // Build local branch items
  const localItems: PaletteItem[] = branches.local.map((branch) => ({
    id: `branch:local:${branch.name}`,
    label: branch.name,
    icon: <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />,
    rightSlot: branch.current && (
      <Check className="h-4 w-4 shrink-0 text-green-500" />
    ),
    onSelect: () => {
      api.push({
        mode: 'branch-actions',
        title: branch.name,
        terminal,
        pr,
        branches,
        branch: {
          name: branch.name,
          isRemote: false,
          isCurrent: branch.current,
        },
      })
    },
    onNavigate: () => {
      api.push({
        mode: 'branch-actions',
        title: branch.name,
        terminal,
        pr,
        branches,
        branch: {
          name: branch.name,
          isRemote: false,
          isCurrent: branch.current,
        },
      })
    },
  }))

  // Build remote branch items
  const remoteItems: PaletteItem[] = branches.remote.map((branch) => ({
    id: `branch:remote:${branch.name}`,
    label: branch.name,
    icon: <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />,
    onSelect: () => {
      api.push({
        mode: 'branch-actions',
        title: branch.name,
        terminal,
        pr,
        branches,
        branch: {
          name: branch.name,
          isRemote: true,
          isCurrent: false,
        },
      })
    },
    onNavigate: () => {
      api.push({
        mode: 'branch-actions',
        title: branch.name,
        terminal,
        pr,
        branches,
        branch: {
          name: branch.name,
          isRemote: true,
          isCurrent: false,
        },
      })
    },
  }))

  // Build groups
  const groups = []
  if (localItems.length > 0) {
    groups.push({ heading: 'Local Branches', items: localItems })
  }
  if (remoteItems.length > 0) {
    groups.push({ heading: 'Remote Branches', items: remoteItems })
  }

  return {
    id: 'branches',
    placeholder: 'Filter branches...',
    items: [],
    groups: groups.length > 0 ? groups : undefined,
    emptyMessage: 'No branches found',
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

export function createBranchActionsMode(
  data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  _api: PaletteAPI,
): PaletteMode {
  const { terminal, branch, branches, loadingStates = {} } = level
  const { gitDirtyStatus } = data

  if (!terminal || !branch) {
    return {
      id: 'branch-actions',
      placeholder: 'Filter actions...',
      items: [],
    }
  }

  // Check dirty state
  const dirtyStatus = gitDirtyStatus[terminal.id]
  const isDirty =
    !!dirtyStatus && (dirtyStatus.added > 0 || dirtyStatus.removed > 0)

  // Check if this local branch has a remote
  const hasRemote =
    branch.isRemote ||
    (branches?.remote.some((r) => r.name === branch.name) ?? false)

  // Any action in progress disables all other actions
  const isLoading =
    !!loadingStates.checkingOut ||
    !!loadingStates.pulling ||
    !!loadingStates.pushing ||
    !!loadingStates.committing ||
    !!loadingStates.creatingBranch

  // Build items
  const items: PaletteItem[] = []

  // Checkout
  const canCheckout = !branch.isCurrent && !isDirty && !isLoading
  items.push({
    id: 'action:checkout',
    label: 'Checkout',
    icon: <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />,
    disabled: !canCheckout,
    disabledReason:
      !branch.isCurrent && isDirty ? 'uncommitted changes' : undefined,
    loading: loadingStates.checkingOut === branch.name,
    onSelect: () => {
      if (canCheckout) {
        actions.checkoutBranch(branch.name, branch.isRemote)
      }
    },
  })

  // Commit (only for current dirty branch)
  if (branch.isCurrent && isDirty) {
    items.push({
      id: 'action:commit',
      label: 'Commit',
      icon: <GitCommitHorizontal className="h-4 w-4 shrink-0 text-zinc-400" />,
      disabled: isLoading,
      loading: !!loadingStates.committing,
      onSelect: () => {
        if (!isLoading) {
          actions.requestCommit(terminal.id)
        }
      },
    })
  }

  // Pull (if has remote)
  if (hasRemote) {
    const canPull = (!branch.isCurrent || !isDirty) && !isLoading
    items.push({
      id: 'action:pull',
      label: 'Pull',
      icon: <ArrowDown className="h-4 w-4 shrink-0 text-zinc-400" />,
      disabled: !canPull,
      disabledReason:
        branch.isCurrent && isDirty ? 'uncommitted changes' : undefined,
      loading: loadingStates.pulling === branch.name,
      onSelect: () => {
        if (canPull) {
          actions.pullBranch(branch.name)
        }
      },
    })
  }

  // Push and Force Push (local branches only)
  if (!branch.isRemote) {
    const canPush = !isDirty && !isLoading

    items.push({
      id: 'action:push',
      label: 'Push',
      icon: <ArrowUp className="h-4 w-4 shrink-0 text-zinc-400" />,
      disabled: !canPush,
      disabledReason: isDirty ? 'uncommitted changes' : undefined,
      loading:
        loadingStates.pushing?.branch === branch.name &&
        !loadingStates.pushing.force,
      onSelect: () => {
        if (canPush) {
          actions.pushBranch(branch.name, false)
        }
      },
    })

    items.push({
      id: 'action:force-push',
      label: 'Force Push',
      icon: <ArrowUp className="h-4 w-4 shrink-0 text-red-400" />,
      disabled: !canPush,
      disabledReason: isDirty ? 'uncommitted changes' : undefined,
      loading:
        loadingStates.pushing?.branch === branch.name &&
        loadingStates.pushing.force,
      onSelect: () => {
        if (canPush) {
          actions.requestForcePush(terminal.id, branch.name)
        }
      },
    })
  }

  // Rebase current branch onto selected branch (for non-current local branches, when not dirty)
  if (!branch.isCurrent && !branch.isRemote) {
    const canRebase = !isDirty && !isLoading
    items.push({
      id: 'action:rebase',
      label: `Rebase ${terminal.git_branch || 'current'} onto ${branch.name}`,
      icon: <GitMerge className="h-4 w-4 shrink-0 text-zinc-400" />,
      disabled: !canRebase,
      disabledReason: isDirty ? 'uncommitted changes' : undefined,
      loading: loadingStates.rebasing === branch.name,
      onSelect: () => {
        if (canRebase) {
          actions.rebaseBranch(branch.name)
        }
      },
    })
  }

  // Delete (for local non-current branches when not dirty)
  if (!branch.isRemote && !branch.isCurrent) {
    const canDelete = !isDirty && !isLoading
    items.push({
      id: 'action:delete',
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4 shrink-0 text-red-400" />,
      disabled: !canDelete,
      disabledReason: isDirty ? 'uncommitted changes' : undefined,
      loading: loadingStates.deleting === branch.name,
      onSelect: () => {
        if (canDelete) {
          actions.requestDeleteBranch(terminal.id, branch.name, hasRemote)
        }
      },
    })
  }

  // Create Branch (available on all branches)
  {
    const canCreate = !isDirty && !isLoading
    items.push({
      id: 'action:create-branch',
      label: 'Create Branch',
      icon: <GitBranchPlus className="h-4 w-4 shrink-0 text-zinc-400" />,
      disabled: !canCreate,
      disabledReason: isDirty ? 'uncommitted changes' : undefined,
      loading: loadingStates.creatingBranch === branch.name,
      onSelect: () => {
        if (canCreate) {
          actions.requestCreateBranch(terminal.id, branch.name)
        }
      },
    })
  }

  return {
    id: 'branch-actions',
    placeholder: 'Filter actions...',
    items,
    width: 'wide',
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
