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
import {
  AlertTriangle,
  Ban,
  Bot,
  CheckIcon,
  ChevronDown,
  FolderOpen,
  PencilIcon,
  Play,
  Plus,
  TrashIcon,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { toast } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { useProcessContext } from '@/context/ProcessContext'
import { useSessionContext } from '@/context/SessionContext'
import { useModifiersHeld } from '@/hooks/useKeyboardShortcuts'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettings } from '@/hooks/useSettings'
import { killShell } from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  SessionWithProject,
  Shell,
  ShellTemplate,
  Terminal,
} from '../types'
import { ConfirmModal } from './ConfirmModal'
import { RenameModal } from './EditSessionModal'
import { ShellTemplateModal } from './ShellTemplateModal'

interface ShellTabsProps {
  terminal: Terminal
  activeShellId: number
  isActiveTerminal?: boolean
  onSelectShell: (shellId: number) => void
  onCreateShell: () => void
  onDeleteShell: (shellId: number) => void
  onRenameShell: (shellId: number, name: string) => Promise<void>
  position?: 'top' | 'bottom'
  className?: string
  children?: React.ReactNode
  rightExtra?: React.ReactNode
}

const sessionStatusColor: Record<string, string> = {
  started: 'text-green-500/80',
  active: 'text-[#D97757]',
  done: 'text-gray-500',
  permission_needed: 'text-[#D97757]',
  idle: 'text-gray-400',
}

function ShellSessionIcon({ session }: { session: SessionWithProject }) {
  const s = 'w-3 h-3 shrink-0'
  if (session.status === 'done')
    return <CheckIcon className={cn(s, 'text-green-500/70')} />
  if (session.status === 'active' || session.status === 'permission_needed')
    return (
      <>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 300 150"
          className={s}
        >
          <path
            fill="none"
            stroke="#D97757"
            strokeWidth="40"
            strokeLinecap="round"
            strokeDasharray="300 385"
            strokeDashoffset="0"
            d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"
          >
            <animate
              attributeName="stroke-dashoffset"
              calcMode="spline"
              dur="2s"
              values="685;-685"
              keySplines="0 0 1 1"
              repeatCount="indefinite"
            />
          </path>
        </svg>
        {session.status === 'permission_needed' && (
          <AlertTriangle className={cn(s, 'text-yellow-500 animate-pulse')} />
        )}
      </>
    )
  return (
    <Bot
      className={cn(s, sessionStatusColor[session.status] ?? 'text-gray-400')}
    />
  )
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
  shellSession,
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
  shellSession?: SessionWithProject
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
      // Order matters: rest (from ContextMenuTrigger asChild) must come before
      // listeners and style so dnd-kit's onPointerDown and transform aren't overridden.
      {...attributes}
      {...rest}
      {...listeners}
      style={style}
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
      {shellSession && <ShellSessionIcon session={shellSession} />}
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
  shellSession,
  position = 'top',
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
  shellSession?: SessionWithProject
  position?: 'top' | 'bottom'
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
      // Order matters: rest (from ContextMenuTrigger asChild) must come before
      // listeners and style so dnd-kit's onPointerDown and transform aren't overridden.
      {...attributes}
      {...rest}
      {...listeners}
      style={style}
      key={shell.id}
      type="button"
      onClick={onSelect}
      className={cn(
        'group/tab flex items-center gap-1.5 px-2 py-1 text-xs transition-colors cursor-pointer flex-shrink-0 min-w-[80px] max-w-[150px]',
        position === 'top' ? 'border-t-2' : 'border-b-2',
        hasActivity
          ? isActive
            ? 'border-green-500/80'
            : 'border-green-500/50 hover:border-green-500'
          : isActive
            ? 'border-primary'
            : 'border-transparent hover:border-primary',
        isActive
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {shellSession && <ShellSessionIcon session={shellSession} />}
      <span className="truncate relative w-full text-center">
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
  position = 'top',
  className,
  children,
  rightExtra,
}: ShellTabsProps) {
  const { processes } = useProcessContext()
  const { sessions } = useSessionContext()

  const { isGoToShellModifierHeld, modifierIcons } = useModifiersHeld()

  // Map shell_id -> most recent non-ended session for this terminal
  const shellSessionMap = new Map<number, SessionWithProject>()
  for (const session of sessions) {
    if (
      session.shell_id != null &&
      session.terminal_id === terminal.id &&
      session.status !== 'ended'
    ) {
      const existing = shellSessionMap.get(session.shell_id)
      if (!existing || session.updated_at > existing.updated_at) {
        shellSessionMap.set(session.shell_id, session)
      }
    }
  }
  const showShortcuts = isActiveTerminal && isGoToShellModifierHeld
  const [wrap, setWrap] = useLocalStorage('shell-tabs-wrap', false)
  const [tabBar, setTabBar] = useLocalStorage('shell-tabs-bar', true)
  const [tabsTop, setTabsTop] = useLocalStorage('shell-tabs-top', true)
  const isMobile = useIsMobile()

  // Force tabs mode on mobile
  useEffect(() => {
    if (isMobile && !tabBar) {
      setTabBar(true)
    }
  }, [isMobile, tabBar, setTabBar])
  const [shellOrder, setShellOrder] = useLocalStorage<Record<number, number[]>>(
    'shell-order',
    {},
  )
  const [killAllConfirm, setKillAllConfirm] = useState(false)
  const [deleteShellId, setDeleteShellId] = useState<number | null>(null)
  const [renameShellTarget, setRenameShellTarget] = useState<Shell | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<
    ShellTemplate | undefined
  >()
  const [deleteTemplateTarget, setDeleteTemplateTarget] =
    useState<ShellTemplate | null>(null)
  const [runTemplateTarget, setRunTemplateTarget] =
    useState<ShellTemplate | null>(null)
  const { settings, updateSettings } = useSettings()

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
    if (isMobile || shellHasActivity(shellId)) {
      setDeleteShellId(shellId)
    } else {
      onDeleteShell(shellId)
    }
  }

  // Listen for shell-close events (from keyboard shortcut) to go through activity check
  const handleDeleteShellRef = useRef(handleDeleteShell)
  handleDeleteShellRef.current = handleDeleteShell
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; shellId: number }>,
    ) => {
      if (e.detail.terminalId === terminal.id) {
        handleDeleteShellRef.current(e.detail.shellId)
      }
    }
    window.addEventListener('shell-close', handler as EventListener)
    return () =>
      window.removeEventListener('shell-close', handler as EventListener)
  }, [terminal.id])

  const deleteShellName = deleteShellId
    ? terminal.shells.find((s) => s.id === deleteShellId)?.name
    : null

  const templates = settings?.shell_templates ?? []

  const handleSaveTemplate = async (template: ShellTemplate) => {
    const existing = templates.filter((t) => t.id !== template.id)
    await updateSettings({ shell_templates: [...existing, template] })
    setTemplateModalOpen(false)
    setEditingTemplate(undefined)
  }

  const handleDeleteTemplate = async (template: ShellTemplate) => {
    await updateSettings({
      shell_templates: templates.filter((t) => t.id !== template.id),
    })
    setDeleteTemplateTarget(null)
  }

  const terminalHasProcesses = terminal.shells.some((s) =>
    shellHasActivity(s.id),
  )

  const runTemplate = (template: ShellTemplate) => {
    window.dispatchEvent(
      new CustomEvent('shell-template-run', {
        detail: { terminalId: terminal.id, template },
      }),
    )
  }

  const handleRunTemplate = (template: ShellTemplate) => {
    setMenuOpen(false)
    if (terminalHasProcesses) {
      setRunTemplateTarget(template)
    } else {
      runTemplate(template)
    }
  }

  const confirmRunTemplate = () => {
    if (runTemplateTarget) {
      runTemplate(runTemplateTarget)
      setRunTemplateTarget(null)
    }
  }

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
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer text-destructive"
          onClick={() => {
            setKillAllConfirm(true)
            setMenuOpen(false)
          }}
        >
          <Ban className="w-3.5 h-3.5" />
          Kill All
        </button>
        <div className="my-1 h-px bg-border" />
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs text-muted-foreground font-medium">
            Templates
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => {
              setEditingTemplate(undefined)
              setTemplateModalOpen(true)
              setMenuOpen(false)
            }}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {templates.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground/60">
            No templates yet
          </div>
        ) : (
          templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="flex w-full items-center gap-1 rounded-sm px-1 py-0.5"
            >
              <button
                type="button"
                className="flex items-center justify-center w-6 h-6 rounded-sm hover:bg-accent cursor-pointer text-muted-foreground hover:text-foreground flex-shrink-0"
                onClick={() => handleRunTemplate(tmpl)}
                title="Run template"
              >
                <Play className="w-3 h-3" />
              </button>
              <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-accent cursor-pointer text-left"
                onClick={() => {
                  setEditingTemplate(tmpl)
                  setTemplateModalOpen(true)
                  setMenuOpen(false)
                }}
              >
                <span className="truncate">{tmpl.name}</span>
                <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">
                  {tmpl.entries.length}
                </span>
              </button>
              <button
                type="button"
                className="flex items-center justify-center w-6 h-6 rounded-sm hover:bg-accent cursor-pointer text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={() => {
                  setDeleteTemplateTarget(tmpl)
                  setMenuOpen(false)
                }}
                title="Delete template"
              >
                <TrashIcon className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
        <div className="my-1 h-px bg-border" />
        <label className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
          Wrap
          <Switch checked={wrap} onCheckedChange={(v) => setWrap(v)} />
        </label>
        <label
          className={cn(
            'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm',
            isMobile ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          Tabs
          <Switch
            checked={tabBar}
            onCheckedChange={(v) => setTabBar(v)}
            disabled={isMobile}
          />
        </label>
        <label
          className={cn(
            'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm',
            tabBar && !isMobile
              ? 'cursor-pointer'
              : 'opacity-50 cursor-not-allowed',
          )}
        >
          Top
          <Switch
            checked={tabsTop}
            onCheckedChange={(v) => setTabsTop(v)}
            disabled={!tabBar || isMobile}
          />
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
        {tabBar && (
          <div className="absolute bottom-[0.02rem] left-0 w-full h-[0.02rem] bg-zinc-400/30"></div>
        )}
        {children && <div className="flex-shrink-0">{children}</div>}
        {/* Shell items — responsive */}
        <div className="flex-1 min-w-0 @container/inner pb-1">
          {/* <400px: pills (hidden on mobile) */}
          <div
            className={cn(
              'flex gap-1 items-center @[400px]/shells:hidden',
              isMobile && 'hidden',
              wrap ? 'flex-wrap' : 'overflow-x-auto flex-nowrap p-0.5',
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
                          shellSession={shellSessionMap.get(shell.id)}
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
                      <ContextMenuContent>
                        <ContextMenuGroup>
                          <ContextMenuItem
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent('open-file-picker', {
                                  detail: { terminal },
                                }),
                              )
                            }
                          >
                            <FolderOpen />
                            Select Files
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        {!isMain && (
                          <>
                            <ContextMenuSeparator />
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
                          </>
                        )}
                      </ContextMenuContent>
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
          {/* >=400px: tabs (always on mobile) */}
          <div
            className={cn(
              '@[400px]/shells:flex items-center gap-1',
              isMobile ? 'flex' : 'hidden',
              wrap ? 'flex-wrap' : 'overflow-x-auto',
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
                          shellSession={shellSessionMap.get(shell.id)}
                          position={position}
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
                      <ContextMenuContent>
                        <ContextMenuGroup>
                          <ContextMenuItem
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent('open-file-picker', {
                                  detail: { terminal },
                                }),
                              )
                            }
                          >
                            <FolderOpen />
                            Select Files
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        {!isMain && (
                          <>
                            <ContextMenuSeparator />
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
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={onCreateShell}
              className={cn(
                'flex items-center justify-center w-5 h-5 border-transparent text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex-shrink-0',
                position === 'top' ? 'border-t-2' : 'border-b-2',
              )}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Menu — single instance, always on the right */}
        <div className="flex-shrink-0 ml-auto flex items-center gap-0.5">
          {menuButton}
          {rightExtra}
        </div>
      </div>
      <ConfirmModal
        open={killAllConfirm}
        title="Kill All Processes"
        message={`This will send Ctrl+C to all ${terminal.shells.length} shell(s) in this terminal.`}
        confirmLabel="Kill All"
        variant="danger"
        onConfirm={() => {
          for (const shell of terminal.shells) {
            killShell(shell.id).catch(() => {})
          }
          toast(`Killed processes in ${terminal.shells.length} shell(s)`)
          setKillAllConfirm(false)
        }}
        onCancel={() => setKillAllConfirm(false)}
      />
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
            const isDuplicate = terminal.shells.some(
              (s) => s.id !== renameShellTarget.id && s.name === name,
            )
            if (isDuplicate) {
              throw new Error('A shell with that name already exists')
            }
            await onRenameShell(renameShellTarget.id, name)
            setRenameShellTarget(null)
          }
        }}
        onCancel={() => setRenameShellTarget(null)}
      />
      <ShellTemplateModal
        open={templateModalOpen}
        template={editingTemplate}
        onSave={handleSaveTemplate}
        onCancel={() => {
          setTemplateModalOpen(false)
          setEditingTemplate(undefined)
        }}
      />
      <ConfirmModal
        open={deleteTemplateTarget !== null}
        title="Delete Template"
        message={`Are you sure you want to delete "${deleteTemplateTarget?.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteTemplateTarget) handleDeleteTemplate(deleteTemplateTarget)
        }}
        onCancel={() => setDeleteTemplateTarget(null)}
      />
      <ConfirmModal
        open={runTemplateTarget !== null}
        title={`Run "${runTemplateTarget?.name}"`}
        message={`This will create ${runTemplateTarget?.entries.length ?? 0} shell${(runTemplateTarget?.entries.length ?? 0) !== 1 ? 's' : ''}:`}
        confirmLabel="Run"
        onConfirm={confirmRunTemplate}
        onCancel={() => setRunTemplateTarget(null)}
      >
        <div className="space-y-1.5 px-1">
          {runTemplateTarget?.entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium shrink-0">{entry.name}</span>
              {entry.command ? (
                <code className="text-muted-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded truncate">
                  {entry.command}
                </code>
              ) : (
                <span className="text-muted-foreground/60 text-xs italic">
                  no command
                </span>
              )}
            </div>
          ))}
        </div>
      </ConfirmModal>
    </>
  )
}
