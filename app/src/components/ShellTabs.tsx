import { ChevronDown, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useProcessContext } from '@/context/ProcessContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/utils'
import type { Terminal } from '../types'
import { ConfirmModal } from './ConfirmModal'

interface ShellTabsProps {
  terminal: Terminal
  activeShellId: number
  isActiveTerminal?: boolean
  onSelectShell: (shellId: number) => void
  onCreateShell: () => void
  onDeleteShell: (shellId: number) => void
  className?: string
}

export function ShellTabs({
  terminal,
  activeShellId,
  isActiveTerminal = true,
  onSelectShell,
  onCreateShell,
  onDeleteShell,
  className,
}: ShellTabsProps) {
  const { processes } = useProcessContext()
  const [wrap, setWrap] = useLocalStorage('shell-tabs-wrap', false)
  const [tabBar, setTabBar] = useLocalStorage('shell-tabs-bar', true)
  const [deleteShellId, setDeleteShellId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const visibleShells = terminal.shells

  const shellHasActivity = (shellId: number) =>
    processes.some((p) => p.shellId === shellId)

  const isMainShell = (shellId: number) =>
    terminal.shells.find((s) => s.id === shellId)?.name === 'main'

  const deleteShellName = deleteShellId
    ? terminal.shells.find((s) => s.id === deleteShellId)?.name
    : null

  const menuButton = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0 text-muted-foreground/60 group-hover/tabs:text-muted-foreground">
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
          Wrap Tabs
          <Switch checked={wrap} onCheckedChange={(v) => setWrap(v)} />
        </label>
        <label className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
          Tab Bar
          <Switch checked={tabBar} onCheckedChange={(v) => setTabBar(v)} />
        </label>
      </PopoverContent>
    </Popover>
  )

  return (
    <>
      <div className={cn('@container/shells group/tabs flex items-center', !isActiveTerminal && 'opacity-50', className)}>
        {/* Shell items — responsive */}
        <div className="flex-1 min-w-0 @container/inner">
          {/* <400px: pills */}
          <div
            className={cn(
              'flex gap-1 items-center @[400px]/shells:hidden',
              wrap ? 'flex-wrap' : 'overflow-x-auto flex-nowrap',
            )}
          >
            {visibleShells.map((shell) => (
              <button
                key={shell.id}
                type="button"
                onClick={() => onSelectShell(shell.id)}
                className={cn(
                  'group/pill flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors cursor-pointer flex-shrink-0',
                  shell.id === activeShellId
                    ? 'bg-accent text-accent-foreground/80'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground/80',
                  shellHasActivity(shell.id)
                    ? shell.id === activeShellId
                      ? 'ring-1 ring-green-500/80'
                      : 'ring-1 ring-green-500/50 hover:ring-green-500/80'
                    : '',
                )}
              >
                {!isMainShell(shell.id) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteShellId(shell.id)
                    }}
                    className="flex-shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                <span className="truncate max-w-[80px]">{shell.name}</span>
              </button>
            ))}
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
            {visibleShells.map((shell) => (
              <button
                key={shell.id}
                type="button"
                onClick={() => onSelectShell(shell.id)}
                className={cn(
                  'group/tab flex items-center gap-1.5 px-2 py-1 text-xs transition-colors cursor-pointer flex-shrink-0 max-w-[150px] border-b-2',
                  shellHasActivity(shell.id)
                    ? shell.id === activeShellId
                      ? 'border-green-500'
                      : 'border-green-500/50 hover:border-green-500'
                    : shell.id === activeShellId
                      ? 'border-primary'
                      : 'border-transparent hover:border-primary',
                  shell.id === activeShellId
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="truncate">{shell.name}</span>
                {!isMainShell(shell.id) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteShellId(shell.id)
                    }}
                    className="flex-shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </button>
            ))}
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
    </>
  )
}
