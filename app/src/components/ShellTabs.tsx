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
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SessionWithProject } from '@domains/sessions/schema'
import type { ShellTemplate } from '@domains/settings/schema'
import type { Shell } from '@domains/workspace/schema/shells'
import type { Terminal } from '@domains/workspace/schema/terminals'
import {
  Activity,
  Ban,
  Bell,
  BellRing,
  Camera,
  ChevronDown,
  Columns2,
  FolderOpen,
  Globe,
  Laptop,
  Monitor,
  PencilIcon,
  Play,
  Plus,
  Rows2,
  Settings,
  Settings2,
  Smartphone,
  Tablet,
  TrashIcon,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SessionStatusIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { useProcessContext } from '@/context/ProcessContext'
import { useSessionContext } from '@/context/SessionContext'
import { useUIState } from '@/context/UIStateContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useModifiersHeld } from '@/hooks/useKeyboardShortcuts'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useOverflowDetector } from '@/hooks/useOverflowDetector'
import { useSettings } from '@/hooks/useSettings'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { ConfirmModal } from './ConfirmModal'
import { RenameModal } from './EditSessionModal'

interface ShellTabsProps {
  terminal: Terminal
  activeShellId: number
  isActiveTerminal?: boolean
  onSelectShell: (shellId: number) => void
  onCreateShell: () => void
  onRenameShell: (shellId: number, name: string) => Promise<void>
  onSaveAsTemplate?: () => void
  position?: 'top' | 'bottom'
  className?: string
  children?: React.ReactNode
  rightExtra?: React.ReactNode
}

function ShellSessionIcon({
  session,
  className,
}: {
  session: SessionWithProject
  className: string
}) {
  if (session.status === 'ended') return null
  return (
    <div className={cn('flex gap-1 mr-0.5', className)}>
      <SessionStatusIcon status={session.status} ended={false} />
    </div>
  )
}

function ShellPopover({
  shell,
  isMain,
  terminal,
  isPill,
  isActive: _isActive,
  onRename,
  onDelete,
}: {
  shell: Shell
  isMain: boolean
  isPill?: boolean
  isActive?: boolean
  terminal: Terminal
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const { subscribeToBell, unsubscribeFromBell, isBellSubscribed } =
    useProcessContext()
  const bellSubscribed = isBellSubscribed(shell.id)
  const hasActiveCmd = !!shell.active_cmd

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setClosing(true)
          setTimeout(() => {
            setClosing(false)
          }, 150)
        } else {
          setClosing(false)
        }
      }}
    >
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              setOpen((o) => !o)
            }
          }}
          className={cn(
            'flex-shrink-0 h-full w-4 absolute right-1 items-center cursor-pointer transition-colors text-muted-foreground rounded sm:hidden max-sm:flex group-hover/tab:flex group-hover/pill:flex justify-center hover:text-foreground',
            (open || closing) && 'text-foreground !flex',
            closing && 'invisible',
          )}
        >
          <div
            className={cn(
              'p-0.5 bg-accent',
              isPill ? 'rounded-full' : 'rounded-sm',
            )}
          >
            <ChevronDown className="w-3.5 h-3.5 min-w-3.5" />
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-fit p-1" align="start" side="bottom">
        <Button
          align="left"
          variant="ghost"
          className="flex w-full items-center gap-2 rounded-sm !px-1.5 !h-8 font-normal text-sm hover:bg-accent cursor-pointer"
          title="Get a notification when the current command ends"
          disabled={!hasActiveCmd}
          onClick={() => {
            if (bellSubscribed) {
              unsubscribeFromBell(shell.id)
            } else {
              subscribeToBell(
                shell.id,
                terminal.id,
                shell.active_cmd!,
                terminal.name ?? `terminal-${terminal.id}`,
              )
              toast.info('You will be notified when this command ends')
            }
            setOpen(false)
          }}
        >
          {bellSubscribed ? (
            <BellRing className="w-3.5 h-3.5 text-yellow-400" />
          ) : (
            <Bell className="w-3.5 h-3.5" />
          )}
          {bellSubscribed ? "Don't notify me" : 'Notify me when done'}
        </Button>
        <Button
          align="left"
          variant="ghost"
          className="flex w-full items-center gap-2 rounded-sm !px-1.5 !h-8 font-normal text-sm hover:bg-accent cursor-pointer"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('open-file-picker', {
                detail: { terminal },
              }),
            )
            setOpen(false)
          }}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Select Files
        </Button>
        <div className="my-1 h-px bg-border max-sm:hidden" />
        <Button
          align="left"
          variant="ghost"
          className="max-sm:hidden flex w-full items-center gap-2 rounded-sm !px-1.5 !h-8 font-normal text-sm hover:bg-accent cursor-pointer"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('shell-split', {
                detail: {
                  terminalId: terminal.id,
                  shellId: shell.id,
                  direction: 'horizontal',
                },
              }),
            )
            setOpen(false)
          }}
        >
          <Columns2 className="w-3.5 h-3.5" />
          Split Vertical
        </Button>
        <Button
          align="left"
          variant="ghost"
          className="max-sm:hidden flex w-full items-center gap-2 rounded-sm !px-1.5 !h-8 font-normal text-sm hover:bg-accent cursor-pointer"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('shell-split', {
                detail: {
                  terminalId: terminal.id,
                  shellId: shell.id,
                  direction: 'vertical',
                },
              }),
            )
            setOpen(false)
          }}
        >
          <Rows2 className="w-3.5 h-3.5" />
          Split Horizontal
        </Button>
        {!isMain && (
          <>
            <div className="my-1 h-px bg-border" />
            <Button
              align="left"
              variant="ghost"
              className="flex w-full items-center gap-2 rounded-sm !px-1.5 !h-8 font-normal text-sm hover:bg-accent cursor-pointer"
              onClick={() => {
                onRename()
                setOpen(false)
              }}
            >
              <PencilIcon className="w-3.5 h-3.5" />
              Rename
            </Button>
            <Button
              align="left"
              variant="ghost"
              className="flex w-full items-center gap-2 rounded-sm !px-1.5 !h-8 font-normal text-sm cursor-pointer !text-destructive"
              onClick={() => {
                onDelete()
                setOpen(false)
              }}
            >
              <TrashIcon className="w-3.5 h-3.5" />
              Close
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function DeviceIcon({
  device,
  className,
}: {
  device: string
  className?: string
}) {
  switch (device) {
    case 'iPhone':
    case 'Android':
      return <Smartphone className={className} />
    case 'iPad':
      return <Tablet className={className} />
    case 'Mac':
      return <Laptop className={className} />
    case 'Windows':
    case 'Linux':
      return <Monitor className={className} />
    default:
      return <Globe className={className} />
  }
}

/** Per-shell client badge — shows clients that have this shell as their active shell. */
function ShellClientsBadge({ shellId }: { shellId: number }) {
  const { shellClients, allClients } = useWorkspaceContext()
  const [isPrimary, setIsPrimary] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handler = (
      e: CustomEvent<{ shellId: number; isPrimary: boolean }>,
    ) => {
      if (e.detail.shellId === shellId) {
        setIsPrimary(e.detail.isPrimary)
      }
    }
    window.addEventListener('primary-status', handler as EventListener)
    return () =>
      window.removeEventListener('primary-status', handler as EventListener)
  }, [shellId])

  const clients = shellClients.get(shellId) ?? []
  const multi = clients.length > 1

  if (clients.length === 0) return null
  if (clients.length === 1 && allClients.length <= 1) return null
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              setIsOpen((o) => !o)
            }
          }}
          className="flex items-center gap-0.5 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer shrink-0"
        >
          {clients.length === 1 ? (
            <DeviceIcon device={clients[0].device} className="w-2.5 h-2.5" />
          ) : (
            <Monitor className="w-2.5 h-2.5" />
          )}
          <span className="text-[10px] font-medium">{clients.length}</span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-fit p-2"
        align="start"
        side="bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5">
          {clients.map((client) => (
            <div key={client.ip}>
              <div className="flex items-center gap-2 text-xs">
                <DeviceIcon
                  device={client.device}
                  className={cn(
                    'w-3.5 h-3.5 shrink-0',
                    multi && client.isPrimary
                      ? 'text-blue-400'
                      : 'text-muted-foreground',
                  )}
                />
                <span>{client.device}</span>
                <span className="text-muted-foreground">{client.browser}</span>
                <span className="text-muted-foreground/60 ml-auto font-mono">
                  {client.ip}
                </span>
              </div>
              {multi && client.isPrimary && (
                <div className="text-[10px] text-muted-foreground/60 ml-5.5 mt-0.5">
                  Controls shell size
                </div>
              )}
            </div>
          ))}
        </div>
        {multi && (
          <div className="mt-2 pt-2 border-t border-border">
            <button
              type="button"
              className="w-full text-xs px-2 py-1 rounded-sm transition-colors text-blue-400 hover:bg-accent cursor-pointer"
              onClick={() => {
                if (isPrimary) {
                  window.dispatchEvent(new Event('release-primary'))
                } else {
                  window.dispatchEvent(new Event('claim-primary'))
                }
                setIsOpen(false)
              }}
            >
              {isPrimary ? 'Handover shell size' : 'Takeover shell size'}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Simple badge for the sidebar — just shows how many clients are connected (no shell-specific controls). */
export function MultiClientIndicator() {
  const { allClients } = useWorkspaceContext()

  if (allClients.length <= 1) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-0.5 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer shrink-0"
        >
          <Monitor className="w-3 h-3" />
          <span className="text-[10px] font-medium">{allClients.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-fit p-2"
        align="start"
        side="bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium text-muted-foreground mb-1.5">
          Connected Devices
        </div>
        <div className="space-y-1.5">
          {allClients.map((client) => (
            <div key={client.ip} className="flex items-center gap-2 text-xs">
              <DeviceIcon
                device={client.device}
                className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
              />
              <span>{client.device}</span>
              <span className="text-muted-foreground">{client.browser}</span>
              <span className="text-muted-foreground/60 ml-auto font-mono">
                {client.ip}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SortableShellPill({
  shell,
  isActive,
  hasActivity,
  bellSubscribed,
  isMain,
  displayName,
  onSelect,
  onDelete,
  onRename,
  terminal,
  shortcutHint,
  shellSession,
  ref,
  ...rest
}: {
  shell: Shell
  isActive: boolean
  hasActivity: boolean
  bellSubscribed: boolean
  isMain: boolean
  displayName: string
  onSelect: () => void
  onDelete: () => void
  onRename: () => void
  terminal: Terminal
  shortcutHint?: React.ReactNode
  shellSession?: SessionWithProject
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const [isHovering, setIsHovering] = useState(false)
  const isMobile = useIsMobile()
  const isShown = isHovering || isMobile
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shell.id })
  const overflowRef = useOverflowDetector<HTMLSpanElement>()

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
      // Order matters: rest must come before listeners and style so
      // dnd-kit's onPointerDown and transform aren't overridden.
      {...attributes}
      {...rest}
      {...listeners}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={style}
      key={shell.id}
      type="button"
      title={shell.active_cmd || undefined}
      onClick={onSelect}
      className={cn(
        'group/pill flex relative max-w-[150px] min-w-[80px] items-center gap-1 px-1 py-0.5 rounded-full text-xs transition-colors cursor-pointer flex-shrink-0',
        isActive
          ? 'bg-accent text-accent-foreground/80'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground/80',
      )}
    >
      <ShellClientsBadge shellId={shell.id} />
      {shellSession ? (
        <ShellSessionIcon
          session={shellSession}
          className={cn(!isActive && 'group-hover/tab:opacity-100 opacity-60')}
        />
      ) : bellSubscribed ? (
        <BellRing className="w-3 h-3 shrink-0 text-yellow-400" />
      ) : hasActivity ? (
        <Activity
          className={cn(
            'w-3 h-3 shrink-0',
            isActive
              ? 'text-green-500'
              : 'group-hover/tab:text-green-500 text-green-500/60',
          )}
        />
      ) : null}
      <span
        ref={overflowRef}
        style={
          {
            '--truncate-fade-to': isShown ? '85%' : '98%',
            '--truncate-fade-from': isShown ? '70%' : '85%',
          } as React.CSSProperties
        }
        className="truncate-fade-custom relative w-full text-center"
      >
        <span className={shortcutHint ? 'invisible' : undefined}>
          {displayName}
        </span>
        {shortcutHint && (
          <span className="absolute inset-0 flex items-center justify-center gap-0.5 font-medium tabular-nums font-mono">
            {shortcutHint}
          </span>
        )}
      </span>
      <ShellPopover
        shell={shell}
        isMain={isMain}
        isPill
        isActive={isActive}
        terminal={terminal}
        onRename={onRename}
        onDelete={onDelete}
      />
    </button>
  )
}

function SortableShellTab({
  shell,
  isActive,
  hasActivity,
  bellSubscribed,
  isMain,
  displayName,
  onSelect,
  onDelete,
  onRename,
  terminal,
  shortcutHint,
  shellSession,
  position = 'top',
  ref,
  ...rest
}: {
  shell: Shell
  isActive: boolean
  hasActivity: boolean
  bellSubscribed: boolean
  isMain: boolean
  displayName: string
  onSelect: () => void
  onDelete: () => void
  onRename: () => void
  terminal: Terminal
  shortcutHint?: React.ReactNode
  shellSession?: SessionWithProject
  position?: 'top' | 'bottom'
  ref?: React.Ref<HTMLButtonElement>
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const [isHovering, setIsHovering] = useState(false)
  const isMobile = useIsMobile()
  const isShown = isHovering || isMobile
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shell.id })
  const overflowRef = useOverflowDetector<HTMLSpanElement>()

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
      // Order matters: rest must come before listeners and style so
      // dnd-kit's onPointerDown and transform aren't overridden.
      {...attributes}
      {...rest}
      {...listeners}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={style}
      key={shell.id}
      type="button"
      title={shell.active_cmd || undefined}
      onClick={onSelect}
      className={cn(
        'group/tab flex items-center relative gap-1.5 px-2 py-1.5 text-xs transition-colors cursor-pointer flex-shrink-0 min-w-[100px] max-w-[180px] border-t-1 border-r-[1px] max-sm:pr-6',
        hasActivity
          ? isActive
            ? 'border-t-green-500/90'
            : 'border-t-green-500/40 hover:border-t-green-500'
          : isActive
            ? 'border-t-primary'
            : 'border-t-transparent hover:border-t-primary',
        isActive
          ? 'text-foreground bg-zinc-500/10 hover:bg-zinc-500/20'
          : 'text-muted-foreground hover:text-foreground hover:bg-zinc-500/10',
      )}
    >
      <ShellClientsBadge shellId={shell.id} />
      {shellSession ? (
        <ShellSessionIcon
          session={shellSession}
          className={cn(!isActive && 'group-hover/tab:opacity-100 opacity-60')}
        />
      ) : bellSubscribed ? (
        <BellRing className="w-3 h-3 shrink-0 text-yellow-400" />
      ) : null}
      <span
        ref={overflowRef}
        style={
          {
            '--truncate-fade-to': isShown ? '90%' : '98%',
            '--truncate-fade-from': isShown ? '78%' : '80%',
          } as React.CSSProperties
        }
        className="truncate-fade-custom relative w-full text-left"
      >
        <span className={shortcutHint ? 'invisible' : undefined}>
          {displayName}
        </span>
        {shortcutHint && (
          <span className="absolute inset-0 flex items-center justify-start gap-0.5 font-medium tabular-nums font-mono">
            {shortcutHint}
          </span>
        )}
      </span>
      <ShellPopover
        shell={shell}
        isMain={isMain}
        isActive={isActive}
        terminal={terminal}
        onRename={onRename}
        onDelete={onDelete}
      />
    </button>
  )
}

function SettingsCloseButton() {
  const uiState = useUIState()
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        uiState.settings.close()
      }}
      className="items-center justify-center text-muted-foreground hover:text-foreground sm:invisible max-sm:visible group-hover/pill:visible group-hover/tab:visible"
    >
      <X className="w-3 h-3" />
    </span>
  )
}

function SettingsPill() {
  const uiState = useUIState()

  return (
    <button
      type="button"
      onClick={() => uiState.settings.focus()}
      className={cn(
        'group/pill flex relative items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] transition-colors cursor-pointer flex-shrink-0',
        uiState.settings.isFocused
          ? 'bg-accent text-accent-foreground/80'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground/80',
      )}
    >
      <Settings className="w-3 h-3" />
      <span>Settings</span>
      <SettingsCloseButton />
    </button>
  )
}

function SettingsTab() {
  const uiState = useUIState()

  return (
    <button
      type="button"
      onClick={() => uiState.settings.focus()}
      className={cn(
        'group/tab flex items-center relative gap-1.5 px-2 py-1.5 text-xs transition-colors flex-shrink-0 border-t-1 border-r-[1px] cursor-pointer',
        uiState.settings.isFocused
          ? 'border-t-primary text-foreground bg-zinc-500/10 hover:bg-zinc-500/20'
          : 'border-t-transparent text-muted-foreground hover:text-foreground hover:bg-zinc-500/10 hover:border-t-primary',
      )}
    >
      <Settings className="w-3 h-3" />
      <span>Settings</span>
      <SettingsCloseButton />
    </button>
  )
}

export function ShellTabs({
  terminal,
  activeShellId,
  isActiveTerminal = true,
  onSelectShell,
  onCreateShell,
  onRenameShell,
  onSaveAsTemplate,
  position = 'top',
  className,
  children,
  rightExtra,
}: ShellTabsProps) {
  const interruptShellMutation =
    trpc.workspace.shells.interruptShell.useMutation()
  const killShellMutation = trpc.workspace.shells.killShell.useMutation()
  const { isBellSubscribed, processes } = useProcessContext()
  const { sessions } = useSessionContext()
  const uiState = useUIState()

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
  const [killAllConfirm, setKillAllConfirm] = useState(false)
  const [deleteShellId, setDeleteShellId] = useState<number | null>(null)
  const [renameShellTarget, setRenameShellTarget] = useState<Shell | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteTemplateTarget, setDeleteTemplateTarget] =
    useState<ShellTemplate | null>(null)
  const [runTemplateTarget, setRunTemplateTarget] =
    useState<ShellTemplate | null>(null)
  const { settings, updateSettings } = useSettings()
  const shellOrder = settings?.shell_order ?? {}

  const handleKillAll = async () => {
    setKillAllConfirm(false)
    const interruptResults = await Promise.all(
      terminal.shells.map(async (shell) => {
        try {
          await interruptShellMutation.mutateAsync({ id: shell.id })
          return true
        } catch (err) {
          toastError(err, 'Failed to interrupt shell')
          return false
        }
      }),
    )
    const interruptedCount = interruptResults.filter(Boolean).length
    if (interruptedCount === 0) return
    setTimeout(async () => {
      const killResults = await Promise.all(
        terminal.shells.map(async (shell) => {
          try {
            await killShellMutation.mutateAsync({ id: shell.id })
            return true
          } catch (err) {
            toastError(err, 'Failed to kill process')
            return false
          }
        }),
      )
      const killedCount = killResults.filter(Boolean).length
      if (killedCount > 0) {
        toast.success(`Killed processes in ${killedCount} shell(s)`)
      }
    }, 1000)
  }

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
    updateSettings({ shell_order: { ...shellOrder, [terminal.id]: newIds } })
  }

  const shellHasActivity = (shellId: number) =>
    processes.some((p) => p.shellId === shellId) ||
    !!terminal.shells.find((s) => s.id === shellId)?.active_cmd

  const isMainShell = (shellId: number) =>
    terminal.shells.find((s) => s.id === shellId)?.name === 'main'

  const handleDeleteShell = (shellId: number) => {
    if (isMobile || shellHasActivity(shellId)) {
      setDeleteShellId(shellId)
    } else {
      window.dispatchEvent(
        new CustomEvent('shell-delete', {
          detail: { terminalId: terminal.id, shellId },
        }),
      )
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

  // Listen for external template-run requests (e.g. from command palette)
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; template: ShellTemplate }>,
    ) => {
      if (e.detail.terminalId !== terminal.id) return
      handleRunTemplate(e.detail.template)
    }
    window.addEventListener('shell-template-request', handler as EventListener)
    return () =>
      window.removeEventListener(
        'shell-template-request',
        handler as EventListener,
      )
  })

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
          <Settings2 className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start" side="bottom">
        <div className="p-1">
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
            disabled={!processes.some((p) => p.terminalId === terminal.id)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              setKillAllConfirm(true)
              setMenuOpen(false)
            }}
          >
            <Ban className="w-3.5 h-3.5" />
            Kill All
          </button>
        </div>
        <div className="my-0 h-px bg-border" />
        <div className="flex items-center justify-between px-2 py-2">
          <span className="text-xs text-muted-foreground font-medium">
            Shell Templates
          </span>
          <div className="flex items-center gap-1">
            {!isMobile && onSaveAsTemplate && (
              <button
                type="button"
                title="Save current layout as template"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => {
                  onSaveAsTemplate()
                  setMenuOpen(false)
                }}
              >
                <Camera className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-template-modal'))
                setMenuOpen(false)
              }}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
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
                  window.dispatchEvent(
                    new CustomEvent('open-template-modal', {
                      detail: { template: tmpl },
                    }),
                  )
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
        <div className="mt-1 h-px bg-border" />
        <div className="p-1">
          <label className="flex hover:bg-accent w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
            Wrap
            <Switch checked={wrap} onCheckedChange={(v) => setWrap(v)} />
          </label>
          <label
            className={cn(
              'flex w-full items-center hover:bg-accent justify-between rounded-sm px-2 py-1.5 text-sm',
              isMobile ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            Tab Bar
            <Switch
              checked={tabBar}
              onCheckedChange={(v) => setTabBar(v)}
              disabled={isMobile}
            />
          </label>
          <label
            className={cn(
              'flex w-full items-center justify-between rounded-sm hover:bg-accent px-2 py-1.5 text-sm',
              tabBar && !isMobile
                ? 'cursor-pointer'
                : 'opacity-50 cursor-not-allowed',
            )}
          >
            On Top
            <Switch
              checked={tabsTop}
              onCheckedChange={(v) => setTabsTop(v)}
              disabled={!tabBar || isMobile}
            />
          </label>
          <div className="my-1 h-px bg-border" />
          <label className="flex hover:bg-accent w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
            Status Bar
            <Switch
              checked={settings?.statusBar?.enabled ?? true}
              onCheckedChange={(v) => {
                if (!settings?.statusBar) return
                updateSettings({
                  statusBar: { ...settings.statusBar, enabled: v },
                })
              }}
            />
          </label>
        </div>
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
        {isMobile && (
          <div className="absolute top-0 left-0 w-full h-[0.02rem] bg-zinc-400/30"></div>
        )}
        {tabBar && (
          <div
            className={cn(
              'absolute left-0 w-full h-[0.02rem] bg-zinc-400/30',
              position === 'top' || isMobile ? 'bottom-0' : 'top-0',
            )}
          ></div>
        )}
        {children && <div className="flex-shrink-0">{children}</div>}
        {/* Shell items — responsive */}
        <div className={cn('flex-1 min-w-0 @container/inner')}>
          {/* <400px: pills (hidden on mobile) */}
          <div
            className={cn(
              'flex gap-1 items-center @[400px]/shells:hidden no-scrollbar',
              isMobile && 'hidden',
              wrap ? 'flex-wrap' : 'overflow-x-auto flex-nowrap p-0.5',
            )}
          >
            {uiState.settings.isOpen && isActiveTerminal && <SettingsPill />}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={
                wrap
                  ? [restrictToParentElement]
                  : [restrictToHorizontalAxis, restrictToParentElement]
              }
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={shellIds}
                strategy={
                  wrap ? rectSortingStrategy : horizontalListSortingStrategy
                }
              >
                {sortedShells.map((shell, index) => {
                  const isMain = isMainShell(shell.id) ?? false
                  const shortcutIndex = index + 1
                  return (
                    <SortableShellPill
                      key={shell.id}
                      shell={shell}
                      isActive={
                        !uiState.settings.isFocused &&
                        shell.id === activeShellId
                      }
                      hasActivity={shellHasActivity(shell.id)}
                      bellSubscribed={isBellSubscribed(shell.id)}
                      isMain={isMain}
                      displayName={
                        shell.active_cmd ??
                        (isMain ? (terminal.name ?? shell.name) : shell.name)
                      }
                      onSelect={() => {
                        uiState.settings.unfocus()
                        onSelectShell(shell.id)
                      }}
                      onDelete={() => handleDeleteShell(shell.id)}
                      onRename={() => setRenameShellTarget(shell)}
                      terminal={terminal}
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
              '@[400px]/shells:flex items-center',
              isMobile ? 'flex' : 'hidden',
              wrap ? 'flex-wrap' : 'overflow-x-auto',
            )}
          >
            {uiState.settings.isOpen && isActiveTerminal && <SettingsTab />}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={
                wrap
                  ? [restrictToParentElement]
                  : [restrictToHorizontalAxis, restrictToParentElement]
              }
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={shellIds}
                strategy={
                  wrap ? rectSortingStrategy : horizontalListSortingStrategy
                }
              >
                {sortedShells.map((shell, index) => {
                  const isMain = isMainShell(shell.id) ?? false
                  const shortcutIndex = index + 1
                  return (
                    <SortableShellTab
                      key={shell.id}
                      shell={shell}
                      isActive={
                        !uiState.settings.isFocused &&
                        shell.id === activeShellId
                      }
                      hasActivity={shellHasActivity(shell.id)}
                      bellSubscribed={isBellSubscribed(shell.id)}
                      isMain={isMain}
                      displayName={
                        shell.active_cmd ??
                        (isMain ? (terminal.name ?? shell.name) : shell.name)
                      }
                      onSelect={() => {
                        uiState.settings.unfocus()
                        onSelectShell(shell.id)
                      }}
                      onDelete={() => handleDeleteShell(shell.id)}
                      onRename={() => setRenameShellTarget(shell)}
                      terminal={terminal}
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
                  )
                })}
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={onCreateShell}
              className={cn(
                'flex items-center justify-center w-8 h-5 border-transparent text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex-shrink-0',
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
        onConfirm={handleKillAll}
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
            window.dispatchEvent(
              new CustomEvent('shell-delete', {
                detail: { terminalId: terminal.id, shellId: deleteShellId },
              }),
            )
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
        message={
          <div>
            This will{' '}
            <span className="mx-1 px-1.5 py-0.5 rounded-md border-[1px] border-red-400/80 text-red-400/80">
              kill all
            </span>{' '}
            shells and create{' '}
            {`${runTemplateTarget?.entries.length ?? 0} new shell${(runTemplateTarget?.entries.length ?? 0) !== 1 ? 's' : ''}`}
            :
          </div>
        }
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
                <code className="text-muted-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded break-all">
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
