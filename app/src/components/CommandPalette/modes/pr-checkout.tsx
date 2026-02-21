import { AlertCircle, CornerDownLeft, GitBranch } from 'lucide-react'
import { TerminalIcon2 } from '@/components/icons'
import type { AppActions, AppData } from '../createPaletteModes'
import { getLastPathSegment } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

export function createPRCheckoutMode(
  data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  _api: PaletteAPI,
): PaletteMode {
  const { pr, loadingStates = {} } = level
  const { terminals, gitDirtyStatus } = data

  if (!pr) {
    return {
      id: 'pr-checkout',
      placeholder: 'Select project...',
      items: [],
    }
  }

  // Find terminals from the same repo
  const matchingTerminals = terminals.filter(
    (t) => t.git_repo?.repo === pr.repo,
  )

  if (matchingTerminals.length === 0) {
    return {
      id: 'pr-checkout',
      placeholder: 'Select project...',
      items: [],
      emptyMessage: 'No projects found',
    }
  }

  const isLoading = !!loadingStates.checkingOut

  const items: PaletteItem[] = matchingTerminals.map((terminal) => {
    const dirtyStatus = gitDirtyStatus[terminal.id]
    const isDirty =
      !!dirtyStatus && (dirtyStatus.added > 0 || dirtyStatus.removed > 0)
    const isOnBranch = terminal.git_branch === pr.branch
    const canCheckout = !isDirty && !isOnBranch && !isLoading

    return {
      id: `terminal:${terminal.id}`,
      label: terminal.name || getLastPathSegment(terminal.cwd),
      description: terminal.git_branch ? (
        <span className="flex items-center gap-1">
          <GitBranch className="text-muted-foreground w-2.5 h-2.5 max-w-2.5 max-h-2.5" />
          <span className="font-medium text-xs">{terminal.git_branch}</span>
          {isDirty && (
            <span className="text-amber-500 flex items-center gap-0.5">
              <AlertCircle className="w-3 h-3" />
              dirty
            </span>
          )}
        </span>
      ) : undefined,
      icon: <TerminalIcon2 className="h-4 w-4 shrink-0 fill-zinc-400" />,
      disabled: !canCheckout,
      disabledReason: isOnBranch
        ? 'already on this branch'
        : isDirty
          ? 'uncommitted changes'
          : undefined,
      loading: loadingStates.checkingOut === `${terminal.id}:${pr.branch}`,
      onSelect: () => {
        if (canCheckout) {
          actions.checkoutPRBranch(terminal.id, pr.branch)
        }
      },
    }
  })

  return {
    id: 'pr-checkout',
    placeholder: 'Select project...',
    items,
    emptyMessage: 'No projects found',
    footer: () => (
      <span className="flex items-center gap-1.5 ml-auto">
        <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
          <CornerDownLeft className="h-3 w-3" />
        </kbd>
        to checkout <span className="font-medium">{pr.branch}</span>
      </span>
    ),
  }
}
