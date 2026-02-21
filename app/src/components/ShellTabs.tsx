import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, PencilIcon, Plus, TrashIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useProcessContext } from '@/context/ProcessContext'
import { useModifiersHeld } from '@/hooks/useKeyboardShortcuts'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import type { Shell, Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'
import { RenameModal } from './EditSessionModal'

interface ShellTabsProps {
  terminal: Terminal
  activeShellId: number
  isActiveTerminal?: boolean
  onSelectShell: (shellId: number) => void
  onCreateShell: () => void
  onDeleteShell: (shellId: number) => void
  onRenameShell: (shellId: number, name: string) => Promise<void>
  className?: string
}

function SortableShellPill({
  shell,
  isActive,
  hasActivity,
  isMain,
  displayName,
  onSelect,
  onDelete,
  shortcutHint,
  ref,
  ...rest
}: {
  shell: Shell
  isActive: boolean
  hasActivity: boolean
  isMain: boolean
  displayName: string
  onSelect: () => void
  onDelete: () => void
  shortcutHint?: React.ReactNode
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shell.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  }

  return (
    <button
      ref={(node) => {
        setNodeRef(node)
        if (typeof ref === 'function') ref(node)
        else if (ref)
          (ref as React.MutableRefObject<HTMLButtonElement | null>).current =
            node
      }}
      style={style}
      {...attributes}
      {...listeners}
      {...rest}
      key={shell.id}
      type="button"
      onClick={onSelect}
      className={cn(
        'group/pill flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors cursor-pointer flex-shrink-0',
        isActive
          ? 'bg-accent text-accent-foreground/80'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground/80',
        hasActivity
          ? isActive
            ? 'ring-1 ring-green-500/80'
            : 'ring-1 ring-green-500/50 hover:ring-green-500/80'
          : '',
      )}
    >
      {!isMain && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="flex-shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      <span className="truncate max-w-[80px] relative">
        <span className={shortcutHint ? 'invisible' : undefined}>
          {displayName}
        </span>
        {shortcutHint && (
          <span className="absolute inset-0 flex items-center justify-center gap-0.5 font-medium tabular-nums font-mono">
            {shortcutHint}
          </span>
        )}
      </span>
    </button>
  )
}

function SortableShellTab({
  shell,
  isActive,
  hasActivity,
  isMain,
  displayName,
  onSelect,
  onDelete,
  shortcutHint,
  ref,
  ...rest
}: {
  shell: Shell
  isActive: boolean
  hasActivity: boolean
  isMain: boolean
  displayName: string
  onSelect: () => void
  onDelete: () => void
  shortcutHint?: React.ReactNode
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shell.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  }

  return (
    <button
      ref={(node) => {
        setNodeRef(node)
        if (typeof ref === 'function') ref(node)
        else if (ref)
          (ref as React.MutableRefObject<HTMLButtonElement | null>).current =
            node
      }}
      style={style}
      {...attributes}
      {...listeners}
      {...rest}
      key={shell.id}
      type="button"
      onClick={onSelect}
      className={cn(
        'group/tab flex items-center gap-1.5 px-2 py-1 text-xs transition-colors cursor-pointer flex-shrink-0 max-w-[150px] border-t-2',
        hasActivity
          ? isActive
            ? 'border-green-500'
            : 'border-green-500/50 hover:border-green-500'
          : isActive
            ? 'border-primary'
            : 'border-transparent hover:border-primary',
        isActive
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="truncate relative">
        <span className={shortcutHint ? 'invisible' : undefined}>
          {displayName}
        </span>
        {shortcutHint && (
          <span className="absolute inset-0 flex items-center justify-center gap-0.5 font-medium tabular-nums font-mono">
            {shortcutHint}
          </span>
        )}
      </span>
      {!isMain && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="flex-shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </button>
  )
}

export function ShellTabs({
  terminal,
  activeShellId,
  isActiveTerminal = true,
  onSelectShell,
  onCreateShell,
  onDeleteShell,
  onRenameShell,
  className,
}: ShellTabsProps) {
  const { processes } = useProcessContext()
  const { isGoToShellModifierHeld, modifierIcons } = useModifiersHeld()
  const showShortcuts = isActiveTerminal && isGoToShellModifierHeld
  const [wrap, setWrap] = useLocalStorage('shell-tabs-wrap', false)
  const [tabBar, setTabBar] = useLocalStorage('shell-tabs-bar', true)
  const [shellOrder, setShellOrder] = useLocalStorage<Record<number, number[]>>(
    'shell-order',
    {},
  )
  const [deleteShellId, setDeleteShellId] = useState<number | null>(null)
  const [renameShellTarget, setRenameShellTarget] = useState<Shell | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // Listen for shell-close events (from keyboard shortcut) to go through activity check
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; shellId: number }>,
    ) => {
      if (e.detail.terminalId === terminal.id) {
        handleDeleteShell(e.detail.shellId)
      }
    }
    window.addEventListener('shell-close', handler as EventListener)
    return () =>
      window.removeEventListener('shell-close', handler as EventListener)
  }, [terminal.id])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // Compute sorted shells from stored order, filtering out deleted shells and appending new ones
  const currentIds = new Set(terminal.shells.map((s) => s.id))
  const storedOrder = shellOrder[terminal.id] ?? []
  const validStored = storedOrder.filter((id) => currentIds.has(id))
  const storedSet = new Set(validStored)
  const newShells = terminal.shells
    .filter((s) => !storedSet.has(s.id))
    .map((s) => s.id)
  const sortedIds = [...validStored, ...newShells]
  const shellMap = new Map(terminal.shells.map((s) => [s.id, s]))
  const sortedShells = sortedIds.map((id) => shellMap.get(id)!).filter(Boolean)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const ids = sortedShells.map((s) => s.id)
    const oldIndex = ids.indexOf(active.id as number)
    const newIndex = ids.indexOf(over.id as number)
    if (oldIndex === -1 || newIndex === -1) return

    const newIds = [...ids]
    newIds.splice(oldIndex, 1)
    newIds.splice(newIndex, 0, active.id as number)
    setShellOrder({ ...shellOrder, [terminal.id]: newIds })
  }

  const shellHasActivity = (shellId: number) =>
    processes.some((p) => p.shellId === shellId)

  const isMainShell = (shellId: number) =>
    terminal.shells.find((s) => s.id === shellId)?.name === 'main'

  const handleDeleteShell = (shellId: number) => {
    if (shellHasActivity(shellId)) {
      setDeleteShellId(shellId)
    } else {
      onDeleteShell(shellId)
    }
  }

  const deleteShellName = deleteShellId
    ? terminal.shells.find((s) => s.id === deleteShellId)?.name
    : null

  const menuButton = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 flex-shrink-0 text-muted-foreground/60 group-hover/tabs:text-muted-foreground"
        >
          <ChevronDown className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" side="bottom">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
          onClick={() => {
            onCreateShell()
            setMenuOpen(false)
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Shell
        </button>
        <div className="my-1 h-px bg-border" />
        <label className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
          Wrap
          <Switch checked={wrap} onCheckedChange={(v) => setWrap(v)} />
        </label>
        <label className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
          Tabs
          <Switch checked={tabBar} onCheckedChange={(v) => setTabBar(v)} />
        </label>
      </PopoverContent>
    </Popover>
  )

  const shellIds = sortedShells.map((s) => s.id)

  return (
    <>
      <div
        className={cn(
          '@container/shells group/tabs flex items-center relative',
          !isActiveTerminal && 'opacity-50',
          className,
        )}
      >
        {tabBar && false && (
          <div className="absolute bottom-[0.02rem] left-0 w-full h-[0.02rem] bg-zinc-400/30"></div>
        )}
        {/* Shell items — responsive */}
        <div className="flex-1 min-w-0 @container/inner">
          {/* <400px: pills */}
          <div
            className={cn(
              'flex gap-1 items-center @[400px]/shells:hidden',
              wrap ? 'flex-wrap' : 'overflow-x-auto flex-nowrap',
            )}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={shellIds}
                strategy={horizontalListSortingStrategy}
              >
                {sortedShells.map((shell, index) => {
                  const isMain = isMainShell(shell.id) ?? false
                  const shortcutIndex = index + 1
                  return (
                    <ContextMenu key={shell.id}>
                      <ContextMenuTrigger asChild>
                        <SortableShellPill
                          shell={shell}
                          isActive={shell.id === activeShellId}
                          hasActivity={shellHasActivity(shell.id)}
                          isMain={isMain}
                          displayName={
                            isMain ? (terminal.name ?? shell.name) : shell.name
                          }
                          onSelect={() => onSelectShell(shell.id)}
                          onDelete={() => handleDeleteShell(shell.id)}
                          shortcutHint={
                            showShortcuts && shortcutIndex <= 9 ? (
                              <>
                                {modifierIcons.goToShell('w-2.5 h-2.5')}
                                {shortcutIndex}
                              </>
                            ) : undefined
                          }
                        />
                      </ContextMenuTrigger>
                      {!isMain && (
                        <ContextMenuContent>
                          <ContextMenuGroup>
                            <ContextMenuItem
                              onClick={() => setRenameShellTarget(shell)}
                            >
                              <PencilIcon />
                              Rename
                            </ContextMenuItem>
                          </ContextMenuGroup>
                          <ContextMenuSeparator />
                          <ContextMenuGroup>
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => handleDeleteShell(shell.id)}
                            >
                              <TrashIcon />
                              Close
                            </ContextMenuItem>
                          </ContextMenuGroup>
                        </ContextMenuContent>
                      )}
                    </ContextMenu>
                  )
                })}
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={onCreateShell}
              className="flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer flex-shrink-0"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          {/* >=400px: tabs */}
          <div
            className={cn(
              'hidden @[400px]/shells:flex items-center',
              wrap ? 'flex-wrap gap-0.5' : 'overflow-x-auto',
            )}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={shellIds}
                strategy={horizontalListSortingStrategy}
              >
                {sortedShells.map((shell, index) => {
                  const isMain = isMainShell(shell.id) ?? false
                  const shortcutIndex = index + 1
                  return (
                    <ContextMenu key={shell.id}>
                      <ContextMenuTrigger asChild>
                        <SortableShellTab
                          shell={shell}
                          isActive={shell.id === activeShellId}
                          hasActivity={shellHasActivity(shell.id)}
                          isMain={isMain}
                          displayName={
                            isMain ? (terminal.name ?? shell.name) : shell.name
                          }
                          onSelect={() => onSelectShell(shell.id)}
                          onDelete={() => handleDeleteShell(shell.id)}
                          shortcutHint={
                            showShortcuts && shortcutIndex <= 9 ? (
                              <>
                                {modifierIcons.goToShell('w-2.5 h-2.5')}
                                {shortcutIndex}
                              </>
                            ) : undefined
                          }
                        />
                      </ContextMenuTrigger>
                      {!isMain && (
                        <ContextMenuContent>
                          <ContextMenuGroup>
                            <ContextMenuItem
                              onClick={() => setRenameShellTarget(shell)}
                            >
                              <PencilIcon />
                              Rename
                            </ContextMenuItem>
                          </ContextMenuGroup>
                          <ContextMenuSeparator />
                          <ContextMenuGroup>
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => handleDeleteShell(shell.id)}
                            >
                              <TrashIcon />
                              Close
                            </ContextMenuItem>
                          </ContextMenuGroup>
                        </ContextMenuContent>
                      )}
                    </ContextMenu>
                  )
                })}
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={onCreateShell}
              className="flex items-center justify-center w-5 h-5 border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex-shrink-0"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Menu — single instance, always on the right */}
        <div className="flex-shrink-0 ml-auto">{menuButton}</div>
      </div>
      <ConfirmModal
        open={deleteShellId !== null}
        title="Delete Shell"
        message={`Are you sure you want to delete "${deleteShellName}"? This will terminate any running processes in this shell.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteShellId !== null) {
            onDeleteShell(deleteShellId)
            setDeleteShellId(null)
          }
        }}
        onCancel={() => setDeleteShellId(null)}
      />
      <RenameModal
        open={renameShellTarget !== null}
        currentName={renameShellTarget?.name ?? ''}
        title="Rename Shell"
        placeholder="Shell name"
        onSave={async (name) => {
          if (renameShellTarget) {
            await onRenameShell(renameShellTarget.id, name)
            setRenameShellTarget(null)
          }
        }}
        onCancel={() => setRenameShellTarget(null)}
      />
    </>
  )
}
