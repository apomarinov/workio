import type { Shell } from '@domains/workspace/schema/shells'
import type { Terminal } from '@domains/workspace/schema/terminals'
import { useRef } from 'react'
import { toast } from '@/components/ui/sonner'
import { useProcessContext } from '@/context/ProcessContext'
import { useSessionContext } from '@/context/SessionContext'
import { useUIState } from '@/context/UIStateContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useSettings } from '@/hooks/useSettings'
import { pullBranch } from '@/lib/api'

/** Return shells in DnD-reordered display order for a terminal */
function getSortedShells(
  terminal: Terminal,
  shellOrder: Record<number, number[]>,
): Shell[] {
  const currentIds = new Set(terminal.shells.map((s) => s.id))
  const storedOrder = shellOrder[terminal.id] ?? []
  const validStored = storedOrder.filter((id: number) => currentIds.has(id))
  const storedSet = new Set(validStored)
  const newShells = terminal.shells
    .filter((s) => !storedSet.has(s.id))
    .map((s) => s.id)
  const sortedIds = [...validStored, ...newShells]
  const shellMap = new Map(terminal.shells.map((s) => [s.id, s]))
  return sortedIds.map((id: number) => shellMap.get(id)!).filter(Boolean)
}

export function AppKeyboardShortcuts() {
  const {
    activeTerminal,
    selectTerminal,
    activeShellsRef,
    setShell,
    orderedTerminals,
  } = useWorkspaceContext()
  const { clearSession } = useSessionContext()
  const { gitDirtyStatus } = useProcessContext()
  const { settings } = useSettings()
  const uiState = useUIState()

  const activeTerminalRef = useRef(activeTerminal)
  activeTerminalRef.current = activeTerminal
  const gitDirtyStatusRef = useRef(gitDirtyStatus)
  gitDirtyStatusRef.current = gitDirtyStatus
  const pullingRef = useRef(false)
  const shellOrderRef = useRef<Record<number, number[]>>({})
  shellOrderRef.current = settings?.shell_order ?? {}

  useKeyboardShortcuts({
    goToTab: (index) => {
      const terminal = orderedTerminals[index - 1]
      if (terminal) {
        selectTerminal(terminal.id)
        clearSession()
        window.dispatchEvent(
          new CustomEvent('reveal-terminal', { detail: { id: terminal.id } }),
        )
      }
    },
    goToShell: (index) => {
      const t = activeTerminalRef.current
      if (!t) return
      const shells = getSortedShells(t, shellOrderRef.current)
      const shell = shells[index - 1]
      if (shell) {
        setShell(t.id, shell.id)
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId: t.id, shellId: shell.id },
          }),
        )
      }
    },
    prevShell: () => {
      const t = activeTerminalRef.current
      if (!t || t.shells.length < 2) return
      const shells = getSortedShells(t, shellOrderRef.current)
      const currentId = activeShellsRef.current[t.id] ?? shells[0]?.id
      const idx = shells.findIndex((s) => s.id === currentId)
      const prev = idx > 0 ? shells[idx - 1] : shells[shells.length - 1]
      if (prev) {
        setShell(t.id, prev.id)
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId: t.id, shellId: prev.id },
          }),
        )
      }
    },
    nextShell: () => {
      const t = activeTerminalRef.current
      if (!t || t.shells.length < 2) return
      const shells = getSortedShells(t, shellOrderRef.current)
      const currentId = activeShellsRef.current[t.id] ?? shells[0]?.id
      const idx = shells.findIndex((s) => s.id === currentId)
      const next = idx < shells.length - 1 ? shells[idx + 1] : shells[0]
      if (next) {
        setShell(t.id, next.id)
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId: t.id, shellId: next.id },
          }),
        )
      }
    },
    palette: () => {
      window.dispatchEvent(new Event('open-palette'))
    },
    togglePip: () => {
      window.dispatchEvent(new Event('toggle-pip'))
    },
    itemActions: () => {
      if (!activeTerminal) return
      window.dispatchEvent(
        new CustomEvent('open-item-actions', {
          detail: {
            terminalId: activeTerminal.id,
            sessionId: null,
          },
        }),
      )
    },
    collapseAll: () => {
      window.dispatchEvent(new Event('collapse-all'))
    },
    settings: () => {
      window.dispatchEvent(new Event('open-settings'))
    },
    newShell: () => {
      const t = activeTerminalRef.current
      if (t) {
        window.dispatchEvent(
          new CustomEvent('shell-create', {
            detail: { terminalId: t.id },
          }),
        )
      }
    },
    closeShell: () => {
      if (uiState.settings.isOpen) {
        uiState.settings.close()
        return
      }
      const t = activeTerminalRef.current
      if (!t) return
      const activeShellId = activeShellsRef.current[t.id]
      if (!activeShellId) return
      const shell = t.shells.find((s) => s.id === activeShellId)
      if (!shell) return
      if (shell.name === 'main') {
        toast.error('Cannot close the main shell')
        return
      }
      window.dispatchEvent(
        new CustomEvent('shell-close', {
          detail: { terminalId: t.id, shellId: activeShellId },
        }),
      )
    },
    commitAmend: () => {
      window.dispatchEvent(new Event('commit-toggle-amend'))
    },
    commitNoVerify: () => {
      window.dispatchEvent(new Event('commit-toggle-no-verify'))
    },
    shellTemplates: () => {
      const t = activeTerminalRef.current
      if (!t) return
      window.dispatchEvent(
        new CustomEvent('open-shell-templates', {
          detail: { terminalId: t.id },
        }),
      )
    },
    customCommands: () => {
      const t = activeTerminalRef.current
      if (!t) return
      window.dispatchEvent(
        new CustomEvent('open-custom-commands', {
          detail: { terminalId: t.id },
        }),
      )
    },
    branches: () => {
      const t = activeTerminalRef.current
      if (!t) return
      window.dispatchEvent(
        new CustomEvent('open-terminal-branches', {
          detail: { terminalId: t.id },
        }),
      )
    },
    toggleSidebar: () => {
      window.dispatchEvent(new Event('toggle-sidebar'))
    },
    commit: () => {
      const t = activeTerminalRef.current
      if (!t) return
      const dirtyStatus = gitDirtyStatusRef.current[t.id]
      const isDirty =
        dirtyStatus &&
        (dirtyStatus.added > 0 ||
          dirtyStatus.removed > 0 ||
          dirtyStatus.untracked > 0)
      if (isDirty) {
        window.dispatchEvent(
          new CustomEvent('open-commit-dialog', {
            detail: { terminalId: t.id },
          }),
        )
      } else if (t.git_branch) {
        window.dispatchEvent(
          new CustomEvent('open-branch-actions', {
            detail: { terminalId: t.id },
          }),
        )
      }
    },
    splitRight: () => {
      const t = activeTerminalRef.current
      if (!t) return
      const shellId = activeShellsRef.current[t.id]
      if (!shellId) return
      window.dispatchEvent(
        new CustomEvent('shell-split', {
          detail: { terminalId: t.id, shellId, direction: 'horizontal' },
        }),
      )
    },
    splitDown: () => {
      const t = activeTerminalRef.current
      if (!t) return
      const shellId = activeShellsRef.current[t.id]
      if (!shellId) return
      window.dispatchEvent(
        new CustomEvent('shell-split', {
          detail: { terminalId: t.id, shellId, direction: 'vertical' },
        }),
      )
    },
    pullBranch: () => {
      if (pullingRef.current) return
      const t = activeTerminalRef.current
      if (!t?.git_branch) return
      const dirtyStatus = gitDirtyStatusRef.current[t.id]
      if (dirtyStatus && (dirtyStatus.added > 0 || dirtyStatus.removed > 0)) {
        toast.warning('Commit or stash your changes before pulling')
        return
      }
      pullingRef.current = true
      const toastId = toast.loading(`Pulling ${t.git_branch}...`)
      pullBranch(t.id, t.git_branch)
        .then(() => toast.success(`Pulled ${t.git_branch}`, { id: toastId }))
        .catch((err) =>
          toast.error(
            err instanceof Error ? err.message : 'Failed to pull branch',
            { id: toastId },
          ),
        )
        .finally(() => {
          pullingRef.current = false
        })
    },
  })

  return null
}
