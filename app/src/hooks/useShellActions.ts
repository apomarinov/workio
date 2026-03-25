import type { ShellTemplate } from '@domains/settings/schema'
import type { Shell } from '@domains/workspace/schema/shells'
import type { Terminal } from '@domains/workspace/schema/terminals'
import { useEffect, useRef } from 'react'
import { toast } from '@/components/ui/sonner'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { useSettings } from './useSettings'

/** Return shells in DnD-reordered display order for a terminal */
export function getSortedShellsFromOrder(
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

export function useShellActions() {
  const {
    terminals,
    refetch,
    cleanupShellOrder,
    setShell,
    setMountAllShellsTerminalId,
  } = useWorkspaceContext()
  const { settings } = useSettings()
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals
  const shellOrderRef = useRef<Record<number, number[]>>({})
  shellOrderRef.current = settings?.shell_order ?? {}

  const createShellMutation = trpc.workspace.shells.createShell.useMutation()
  const deleteShellMutation = trpc.workspace.shells.deleteShell.useMutation()
  const renameShellMutation = trpc.workspace.shells.renameShell.useMutation()
  const writeShellMutation = trpc.workspace.shells.writeShell.useMutation()
  const interruptShellMutation =
    trpc.workspace.shells.interruptShell.useMutation()

  const handleCreateShell = async (terminalId: number) => {
    try {
      const shell = await createShellMutation.mutateAsync({ terminalId })
      await refetch()
      setShell(terminalId, shell.id)
      window.dispatchEvent(
        new CustomEvent('shell-select', {
          detail: { terminalId, shellId: shell.id },
        }),
      )
    } catch (err) {
      toastError(err, 'Failed to create shell')
    }
  }

  const handleDeleteShell = async (terminalId: number, shellId: number) => {
    try {
      const terminalBefore = terminalsRef.current.find(
        (t) => t.id === terminalId,
      )
      const shellsBefore = terminalBefore?.shells ?? []
      const deletedIndex = shellsBefore.findIndex((s) => s.id === shellId)

      await deleteShellMutation.mutateAsync({ id: shellId })
      cleanupShellOrder(terminalId, shellId)
      setTimeout(async () => {
        await refetch()
        const terminal = terminalsRef.current.find((t) => t.id === terminalId)
        const remaining = terminal?.shells ?? []
        if (remaining.length === 0) return

        const nextShell =
          remaining[Math.min(deletedIndex, remaining.length - 1)] ??
          remaining.find((s) => s.name === 'main') ??
          remaining[0]

        setShell(terminalId, nextShell.id)
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId, shellId: nextShell.id },
          }),
        )
      }, 50)
    } catch (err) {
      toastError(err, 'Failed to delete shell')
    }
  }

  const handleRenameShell = async (shellId: number, name: string) => {
    await renameShellMutation.mutateAsync({ id: shellId, name })
    await refetch()
  }

  // Refs for shell handlers so event listeners get latest versions
  const handleCreateShellRef = useRef(handleCreateShell)
  handleCreateShellRef.current = handleCreateShell
  const handleDeleteShellRef = useRef(handleDeleteShell)
  handleDeleteShellRef.current = handleDeleteShell
  const handleRenameShellRef = useRef(handleRenameShell)
  handleRenameShellRef.current = handleRenameShell

  // Shell template execution
  const handleRunTemplate = async (
    terminalId: number,
    template: ShellTemplate,
  ) => {
    try {
      const terminal = terminalsRef.current.find((t) => t.id === terminalId)
      if (!terminal) return

      // 1. Delete all non-main shells
      const nonMainShells = terminal.shells.filter((s) => s.name !== 'main')
      await Promise.all(
        nonMainShells.map((shell) =>
          deleteShellMutation.mutateAsync({ id: shell.id }),
        ),
      )

      // 2. Interrupt main shell and wait for it to be idle
      const mainShell = terminal.shells.find((s) => s.name === 'main')
      if (mainShell) {
        await interruptShellMutation.mutateAsync({ id: mainShell.id })
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100))
          await refetch()
          const current = terminalsRef.current.find((t) => t.id === terminalId)
          const shell = current?.shells.find((s) => s.id === mainShell.id)
          if (!shell?.active_cmd) break
        }
      }

      // 3. Mount all shells for this terminal so new ones get PTY connections
      setMountAllShellsTerminalId(terminalId)

      // 4. Create custom shells from template entries (skip first, that's main)
      const customEntries = template.entries.slice(1)
      const createdShellIds: number[] = []
      for (const entry of customEntries) {
        const newShell = await createShellMutation.mutateAsync({
          terminalId,
          name: entry.name,
        })
        createdShellIds.push(newShell.id)
      }

      // 5. Queue commands via pending (runs after shell integration is ready)
      const writes: Promise<void>[] = []
      if (mainShell && template.entries[0]?.command) {
        writes.push(
          writeShellMutation.mutateAsync({
            id: mainShell.id,
            data: `${template.entries[0].command}\n`,
          }),
        )
      }
      for (let i = 0; i < customEntries.length; i++) {
        if (customEntries[i].command) {
          writes.push(
            writeShellMutation.mutateAsync({
              id: createdShellIds[i],
              data: `${customEntries[i].command}\n`,
              pending: true,
            }),
          )
        }
      }
      await Promise.all(writes)

      // 6. Refetch so React renders the new shells (mount-all flag ensures they mount)
      await refetch()

      // 7. Set active shell to main
      if (mainShell) {
        setShell(terminalId, mainShell.id)
      }

      toast.success(`Template "${template.name}" started`)
    } catch (err) {
      setMountAllShellsTerminalId(null)
      toastError(err, 'Failed to run template')
    }
  }

  // Shell event listeners (dispatched from TerminalItem sidebar)
  useEffect(() => {
    const onSelect = (
      e: CustomEvent<{ terminalId: number; shellId: number }>,
    ) => {
      setShell(e.detail.terminalId, e.detail.shellId)
    }
    const onCreate = (e: CustomEvent<{ terminalId: number }>) => {
      handleCreateShellRef.current(e.detail.terminalId)
    }
    const onDelete = (
      e: CustomEvent<{ terminalId: number; shellId: number }>,
    ) => {
      handleDeleteShellRef.current(e.detail.terminalId, e.detail.shellId)
    }
    const onRename = (e: CustomEvent<{ shellId: number; name: string }>) => {
      handleRenameShellRef.current(e.detail.shellId, e.detail.name)
    }
    const onTemplateRun = (
      e: CustomEvent<{ terminalId: number; template: ShellTemplate }>,
    ) => {
      handleRunTemplate(e.detail.terminalId, e.detail.template)
    }

    window.addEventListener('shell-select', onSelect as EventListener)
    window.addEventListener('shell-create', onCreate as EventListener)
    window.addEventListener('shell-delete', onDelete as EventListener)
    window.addEventListener('shell-rename', onRename as EventListener)
    window.addEventListener(
      'shell-template-run',
      onTemplateRun as EventListener,
    )
    return () => {
      window.removeEventListener('shell-select', onSelect as EventListener)
      window.removeEventListener('shell-create', onCreate as EventListener)
      window.removeEventListener('shell-delete', onDelete as EventListener)
      window.removeEventListener('shell-rename', onRename as EventListener)
      window.removeEventListener(
        'shell-template-run',
        onTemplateRun as EventListener,
      )
    }
  }, [])

  const getSortedShells = (terminal: Terminal) => {
    return getSortedShellsFromOrder(terminal, shellOrderRef.current)
  }

  return { handleCreateShell, handleRenameShell, getSortedShells }
}
