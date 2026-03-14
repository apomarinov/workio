import { useProcessContext } from '../context/ProcessContext'
import { useWorkspaceContext } from '../context/WorkspaceContext'

export function useMountedShells(): Set<number> {
  const { terminals, activeTerminal, activeShells, shouldMountShell } =
    useWorkspaceContext()
  const { processes } = useProcessContext()

  const set = new Set<number>()
  for (const terminal of terminals) {
    const activeShellId = activeShells[terminal.id]
    for (const shell of terminal.shells) {
      const isActive =
        terminal.id === activeTerminal?.id && shell.id === activeShellId
      const hasActivity =
        !!shell.active_cmd || processes.some((p) => p.shellId === shell.id)
      if (shouldMountShell(shell.id, isActive, hasActivity)) {
        set.add(shell.id)
      }
    }
  }
  return set
}
