import {
  ChevronLeft,
  Keyboard,
  KeyboardOff,
  LayoutGrid,
  Plus,
  Settings,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { Toaster, toast } from '@/components/ui/sonner'
import { CommandPalette } from './components/CommandPalette'
import { CreateTerminalModal } from './components/CreateTerminalModal'
import { PinnedSessionsPip } from './components/PinnedSessionsPip'
import { ShellTabs } from './components/ShellTabs'
import { Sidebar } from './components/Sidebar'

const SessionChat = lazy(() =>
  import('./components/SessionChat').then((m) => ({ default: m.SessionChat })),
)

import { MobileKeyboard } from './components/MobileKeyboard'
import { Terminal } from './components/Terminal'
import { DocumentPipProvider } from './context/DocumentPipContext'
import { useNotifications } from './context/NotificationContext'
import { ProcessProvider } from './context/ProcessContext'
import { SessionProvider, useSessionContext } from './context/SessionContext'
import { TerminalProvider, useTerminalContext } from './context/TerminalContext'
import { useActivePermissions } from './hooks/useActivePermissions'
import { useActiveShells } from './hooks/useActiveShells'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useIsMobile } from './hooks/useMediaQuery'
import { useSocket } from './hooks/useSocket'
import {
  createShellForTerminal,
  deleteShell,
  interruptShell,
  renameShell,
  writeToShell,
} from './lib/api'
import { cn } from './lib/utils'
import type { HookEvent, ShellTemplate } from './types'

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

function AppContent() {
  const {
    terminals,
    markShellActive,
    loading,
    activeTerminal,
    selectTerminal,
    selectPreviousTerminal,
    refetch,
  } = useTerminalContext()
  const { activeSessionId, selectSession, sessions } = useSessionContext()
  const { subscribe, emit } = useSocket()
  const { sendNotification } = useNotifications()
  useActivePermissions()
  const { clearSession } = useSessionContext()
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals
  const activeTerminalRef = useRef(activeTerminal)
  activeTerminalRef.current = activeTerminal

  // Shell DnD order — kept in sync with localStorage used by ShellTabs
  const shellOrderRef = useRef<Record<number, number[]>>(
    (() => {
      try {
        const saved = localStorage.getItem('shell-order')
        return saved ? JSON.parse(saved) : {}
      } catch {
        return {}
      }
    })(),
  )
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'shell-order') {
        try {
          shellOrderRef.current = e.newValue ? JSON.parse(e.newValue) : {}
        } catch {
          /* ignore */
        }
      }
    }
    const onLocalSync = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === 'shell-order') {
        shellOrderRef.current = detail.value ?? {}
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('local-storage-sync', onLocalSync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('local-storage-sync', onLocalSync)
    }
  }, [])

  // Multi-shell state
  const { activeShells, activeShellsRef, setShell } = useActiveShells(
    terminals,
    activeTerminal?.id ?? null,
  )

  const [tabBar] = useLocalStorage('shell-tabs-bar', true)
  const [tabsTop] = useLocalStorage('shell-tabs-top', true)
  const isMobile = useIsMobile()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileKeyboardMode, setMobileKeyboardMode] = useState<
    'hidden' | 'input' | 'actions'
  >('hidden')
  const mobileInputRef = useRef<HTMLTextAreaElement>(null)

  // Mark active shells so the context can track suspension timestamps
  useEffect(() => {
    for (const shellId of Object.values(activeShells)) {
      markShellActive(shellId)
    }
    // Also refresh on interval to prevent the current shell from going stale
    const id = setInterval(() => {
      for (const shellId of Object.values(activeShellsRef.current)) {
        markShellActive(shellId)
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [activeShells, markShellActive])

  const handleCreateShell = async (terminalId: number) => {
    try {
      const shell = await createShellForTerminal(terminalId)
      await refetch()
      setShell(terminalId, shell.id)
      window.dispatchEvent(
        new CustomEvent('shell-select', {
          detail: { terminalId, shellId: shell.id },
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create shell')
    }
  }

  const handleDeleteShell = async (terminalId: number, shellId: number) => {
    try {
      // Snapshot shell list before deletion to find adjacent shell
      const terminalBefore = terminalsRef.current.find(
        (t) => t.id === terminalId,
      )
      const shellsBefore = terminalBefore?.shells ?? []
      const deletedIndex = shellsBefore.findIndex((s) => s.id === shellId)

      await deleteShell(shellId)
      await refetch()

      const terminal = terminalsRef.current.find((t) => t.id === terminalId)
      const remaining = terminal?.shells ?? []
      if (remaining.length === 0) return

      // Pick next shell at same index (or last if deleted was at end), fallback to main
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete shell')
    }
  }

  const handleRenameShell = async (shellId: number, name: string) => {
    await renameShell(shellId, name)
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
      for (const shell of nonMainShells) {
        await deleteShell(shell.id)
      }

      // 2. Interrupt main shell
      const mainShell = terminal.shells.find((s) => s.name === 'main')
      if (mainShell) {
        await interruptShell(mainShell.id).catch(() =>
          toast.error('Failed to interrupt shell'),
        )
      }

      // 3. Wait for things to settle
      await new Promise((r) => setTimeout(r, 300))

      // 4. Create custom shells from template entries (skip first, that's main)
      const customEntries = template.entries.slice(1)
      const createdShellIds: number[] = []
      for (const entry of customEntries) {
        const shell = await createShellForTerminal(terminalId, entry.name)
        createdShellIds.push(shell.id)
      }

      // 5. Refetch to get updated terminal state
      await refetch()

      // 6. Send commands to main shell
      if (mainShell && template.entries[0]?.command) {
        await writeToShell(mainShell.id, `${template.entries[0].command}\n`)
      }

      // 7. Send commands to custom shells
      for (let i = 0; i < customEntries.length; i++) {
        if (customEntries[i].command) {
          await writeToShell(
            createdShellIds[i],
            `${customEntries[i].command}\n`,
          )
        }
      }

      // 8. Set active shell to main
      if (mainShell) {
        setShell(terminalId, mainShell.id)
      }

      toast.success(`Template "${template.name}" started`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run template')
    }
  }

  // Listen for shell-template-run events
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; template: ShellTemplate }>,
    ) => {
      handleRunTemplate(e.detail.terminalId, e.detail.template)
    }
    window.addEventListener('shell-template-run', handler as EventListener)
    return () =>
      window.removeEventListener('shell-template-run', handler as EventListener)
  }, [])

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

    window.addEventListener('shell-select', onSelect as EventListener)
    window.addEventListener('shell-create', onCreate as EventListener)
    window.addEventListener('shell-delete', onDelete as EventListener)
    window.addEventListener('shell-rename', onRename as EventListener)
    return () => {
      window.removeEventListener('shell-select', onSelect as EventListener)
      window.removeEventListener('shell-create', onCreate as EventListener)
      window.removeEventListener('shell-delete', onDelete as EventListener)
      window.removeEventListener('shell-rename', onRename as EventListener)
    }
  }, [])

  // Helper: return shells in DnD-reordered display order for a terminal
  const getSortedShells = (t: (typeof terminals)[number]) => {
    const currentIds = new Set(t.shells.map((s) => s.id))
    const storedOrder = shellOrderRef.current[t.id] ?? []
    const validStored = storedOrder.filter((id: number) => currentIds.has(id))
    const storedSet = new Set(validStored)
    const newShells = t.shells
      .filter((s) => !storedSet.has(s.id))
      .map((s) => s.id)
    const sortedIds = [...validStored, ...newShells]
    const shellMap = new Map(t.shells.map((s) => [s.id, s]))
    return sortedIds.map((id: number) => shellMap.get(id)!).filter(Boolean)
  }

  useKeyboardShortcuts({
    goToTab: (index) => {
      // Use render order: repo-grouped terminals first, then ungrouped
      const all = terminalsRef.current
      const grouped: typeof all = []
      const ungrouped: typeof all = []
      for (const t of all) {
        if (t.git_repo?.repo) grouped.push(t)
        else ungrouped.push(t)
      }
      const ordered = [...grouped, ...ungrouped]
      const terminal = ordered[index - 1]
      if (terminal) {
        selectTerminal(terminal.id)
        clearSession()
        window.dispatchEvent(
          new CustomEvent('reveal-terminal', { detail: { id: terminal.id } }),
        )
      }
    },
    goToLastTab: () => {
      selectPreviousTerminal()
      clearSession()
    },
    goToShell: (index) => {
      const t = activeTerminalRef.current
      if (!t) return
      const shells = getSortedShells(t)
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
      const shells = getSortedShells(t)
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
      const shells = getSortedShells(t)
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
      if (t) handleCreateShellRef.current(t.id)
    },
    closeShell: () => {
      const t = activeTerminalRef.current
      if (!t) return
      const activeShellId = activeShellsRef.current[t.id]
      if (!activeShellId) return
      const shell = t.shells.find((s) => s.id === activeShellId)
      if (!shell || shell.name === 'main') return
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
  })

  // Example: Change favicon based on session status
  useEffect(() => {
    const hasPermissionNeeded = sessions.some(
      (s) => s.status === 'permission_needed',
    )
    const hasActive = sessions.some((s) => s.status === 'active')

    if (hasPermissionNeeded) {
      setFavicon('/favicon-warning.svg')
    } else if (hasActive) {
      setFavicon('/favicon-active.svg')
    } else {
      setFavicon('/favicon.svg')
    }
  }, [sessions])

  // Auto-select first active session when there are no terminals
  useEffect(() => {
    if (
      !loading &&
      terminals.length === 0 &&
      sessions.length > 0 &&
      !activeSessionId
    ) {
      const activeSession = sessions.find(
        (s) => s.status === 'active' || s.status === 'permission_needed',
      )
      const sessionToSelect = activeSession || sessions[0]
      if (sessionToSelect) {
        selectSession(sessionToSelect.session_id)
      }
    }
  }, [loading, terminals.length, sessions, activeSessionId, selectSession])

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'main-layout',
    storage: localStorage,
  })

  const handleSidebarResize = (size: PanelSize) => {
    setSidebarWidth(size.inPixels)
  }

  // Subscribe to hook events for notifications
  useEffect(() => {
    return subscribe<HookEvent>('hook', (data) => {
      const session = sessions.find((t) => t.session_id === data.session_id)
      const terminal = terminals.find(
        (t) => t.id === data.terminal_id || t.cwd === data.project_path,
      )
      const terminalName =
        session?.latest_agent_message ||
        terminal?.name ||
        terminal?.cwd ||
        data.project_path ||
        'Claude'
      let title = session?.latest_user_message || session?.name

      const notiData = {
        type:
          data.status === 'permission_needed' ? 'permission_needed' : 'stop',
        terminalId: terminal?.id ?? data.terminal_id,
        shellId: data.shell_id,
        sessionId: data.session_id,
      }

      if (data.status === 'permission_needed') {
        title ||= 'Permission Required'

        sendNotification(`⚠️ ${title}`, {
          body: `"${terminalName}" needs permissions`,
          audio: 'permission',
          data: notiData,
          tag: data.session_id ? `session:${data.session_id}` : undefined,
        })
      } else if (data.hook_type === 'Stop') {
        title ||= 'Done'

        sendNotification(`✅ ${title}`, {
          body: `"${terminalName}" has finished`,
          audio: 'done',
          data: notiData,
          tag: data.session_id ? `session:${data.session_id}` : undefined,
        })
      }
    })
  }, [subscribe, sendNotification, terminals, sessions])

  // Handle push notification clicks from service worker
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'NOTIFICATION_CLICK') return
      const data = event.data.data as Record<string, unknown> | undefined
      if (!data) return

      const terminalId = data.terminalId as number | undefined
      const shellId = data.shellId as number | undefined
      const terminal = terminalId
        ? terminals.find((t) => t.id === terminalId)
        : undefined

      if (terminal && shellId) {
        selectTerminal(terminal.id)
        setShell(terminal.id, shellId)
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId: terminal.id, shellId },
          }),
        )
        setMobileKeyboardMode('input')
      } else if (terminal) {
        selectTerminal(terminal.id)
        setMobileKeyboardMode('input')
      }
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () =>
      navigator.serviceWorker?.removeEventListener('message', handler)
  }, [terminals, selectTerminal])

  // Report user activity to server so push notifications are suppressed while active
  useEffect(() => {
    let lastEmit = 0
    const THROTTLE_MS = 30_000
    const handler = () => {
      const now = Date.now()
      if (now - lastEmit > THROTTLE_MS) {
        lastEmit = now
        emit('user:active')
      }
    }
    window.addEventListener('mousemove', handler)
    window.addEventListener('keydown', handler)
    window.addEventListener('terminal-activity', handler)
    // Emit once on mount so the server knows we're here
    emit('user:active')
    return () => {
      window.removeEventListener('mousemove', handler)
      window.removeEventListener('keydown', handler)
      window.removeEventListener('terminal-activity', handler)
    }
  }, [emit])

  // Auto-close mobile sidebar when navigating to a terminal or session
  const prevActiveTerminalId = useRef(activeTerminal?.id)
  const prevActiveSessionId = useRef(activeSessionId)
  useEffect(() => {
    if (
      mobileSidebarOpen &&
      (activeTerminal?.id !== prevActiveTerminalId.current ||
        activeSessionId !== prevActiveSessionId.current)
    ) {
      setMobileSidebarOpen(false)
    }
    prevActiveTerminalId.current = activeTerminal?.id
    prevActiveSessionId.current = activeSessionId
  }, [activeTerminal?.id, activeSessionId, mobileSidebarOpen])

  // Track visual viewport height on mobile so the layout shrinks when the
  // iOS keyboard opens, keeping our bottom bar visible above it.
  useEffect(() => {
    if (!isMobile) return
    const root = document.getElementById('root')
    if (!root) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      root.style.height = `${vv.height}px`
      // iOS scrolls the page when a fixed-input gets focus.  Since our input
      // lives inside the in-flow bottom bar, undo that scroll so the terminal
      // doesn't get pushed up leaving blank space.
      window.scrollTo(0, 0)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.height = ''
    }
  }, [isMobile])

  const effectiveTabsTop = isMobile ? false : tabsTop

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  const mainContent = (
    <div className="h-full relative">
      {activeSessionId ? (
        <div className="absolute inset-0 z-20">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center bg-zinc-950 text-zinc-400">
                Loading...
              </div>
            }
          >
            <SessionChat />
          </Suspense>
        </div>
      ) : terminals.length === 0 ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#1a1a1a]">
          <Button
            variant="outline"
            size="lg"
            className="gap-2 text-base"
            onClick={() => setCreateModalOpen(true)}
          >
            <Plus className="w-5 h-5" />
            Create New Project
          </Button>
          <CreateTerminalModal
            open={createModalOpen}
            onOpenChange={setCreateModalOpen}
            onCreated={(id) => selectTerminal(id)}
          />
        </div>
      ) : null}
      {terminals.map((t) => {
        const activeShellId =
          activeShells[t.id] ??
          t.shells.find((s) => s.name === 'main')?.id ??
          t.shells[0]?.id
        const isTermVisible = !activeSessionId && t.id === activeTerminal?.id

        return (
          <div
            key={t.id}
            className={cn(
              'absolute inset-0 flex bg-[#1a1a1a]',
              effectiveTabsTop ? 'flex-col' : 'flex-col-reverse',
              !isTermVisible && 'invisible',
            )}
          >
            {tabBar && activeShellId != null && !isMobile && (
              <ShellTabs
                terminal={t}
                activeShellId={activeShellId}
                onSelectShell={(shellId) => setShell(t.id, shellId)}
                onCreateShell={() => handleCreateShell(t.id)}
                onDeleteShell={(shellId) => handleDeleteShell(t.id, shellId)}
                onRenameShell={handleRenameShell}
                position={effectiveTabsTop ? 'top' : 'bottom'}
                className="pr-2 pl-1 bg-[#1a1a1a]"
              />
            )}
            <div className="relative flex-1 min-h-0">
              {t.shells.map((shell) => {
                if (shell.isSuspended && shell.id !== activeShellId) return null
                return (
                  <Terminal
                    key={shell.id}
                    terminalId={t.id}
                    shellId={shell.id}
                    isVisible={isTermVisible && shell.id === activeShellId}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      {isMobile ? (
        <div
          className="flex flex-col bg-zinc-950 overflow-hidden h-full"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {/* Fullscreen terminal */}
          <div className="flex-1 min-h-0">{mainContent}</div>
          {/* Bottom bar: ShellTabs + MobileKeyboard (in flow so it sits above the iOS keyboard) */}
          {activeTerminal &&
            !activeSessionId &&
            (() => {
              const t = activeTerminal
              const activeShellId =
                activeShells[t.id] ??
                t.shells.find((s) => s.name === 'main')?.id ??
                t.shells[0]?.id
              return (
                <div className="flex-shrink-0 bg-zinc-900">
                  {tabBar && activeShellId != null && (
                    <ShellTabs
                      terminal={t}
                      activeShellId={activeShellId}
                      onSelectShell={(shellId) => setShell(t.id, shellId)}
                      onCreateShell={() => handleCreateShell(t.id)}
                      onDeleteShell={(shellId) =>
                        handleDeleteShell(t.id, shellId)
                      }
                      onRenameShell={handleRenameShell}
                      position="bottom"
                      className="pr-2 pl-1 bg-[#1a1a1a]"
                      rightExtra={
                        <div className="flex items-center gap-0.5">
                          {mobileKeyboardMode === 'hidden' && (
                            <button
                              type="button"
                              onClick={() => {
                                mobileInputRef.current?.focus()
                                setMobileKeyboardMode('input')
                              }}
                              className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <Keyboard className="w-4 h-4" />
                            </button>
                          )}
                          {mobileKeyboardMode !== 'hidden' && (
                            <button
                              type="button"
                              onClick={() =>
                                window.dispatchEvent(
                                  new Event('mobile-keyboard-customize'),
                                )
                              }
                              className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <Settings className="w-4 h-4" />
                            </button>
                          )}
                          {mobileKeyboardMode === 'input' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setMobileKeyboardMode('actions')}
                                className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              >
                                <LayoutGrid className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setMobileKeyboardMode('hidden')}
                                className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              >
                                <KeyboardOff className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {mobileKeyboardMode === 'actions' && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  mobileInputRef.current?.focus()
                                  setMobileKeyboardMode('input')
                                }}
                                className="flex items-center justify-center h-7 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              >
                                ABC
                              </button>
                              <button
                                type="button"
                                onClick={() => setMobileKeyboardMode('hidden')}
                                className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              >
                                <KeyboardOff className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(true)}
                        className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer mr-1"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                    </ShellTabs>
                  )}
                  <MobileKeyboard
                    terminalId={t.id}
                    mode={mobileKeyboardMode}
                    inputRef={mobileInputRef}
                  />
                </div>
              )
            })()}
          {/* Sidebar overlay */}
          <div
            className={cn(
              'fixed inset-0 z-50',
              !mobileSidebarOpen && 'pointer-events-none',
            )}
          >
            {/* Backdrop */}
            <div
              className={cn(
                'fixed inset-0 bg-black/50 transition-opacity duration-300',
                mobileSidebarOpen
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none',
              )}
              onClick={() => setMobileSidebarOpen(false)}
            />
            {/* Sidebar panel */}
            <div
              className={cn(
                'fixed inset-y-0 left-0 w-full bg-sidebar transition-transform duration-300 ease-in-out pt-[env(safe-area-inset-top)]',
                mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
              )}
            >
              <Sidebar onDismiss={() => setMobileSidebarOpen(false)} />
            </div>
          </div>
        </div>
      ) : (
        <Group
          orientation="horizontal"
          className="h-full bg-zinc-950"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel
            id="sidebar"
            defaultSize="250px"
            minSize="150px"
            maxSize="50%"
            onResize={handleSidebarResize}
          >
            <Sidebar width={sidebarWidth} />
          </Panel>
          <Separator className="panel-resize-handle" />
          <Panel id="main">{mainContent}</Panel>
        </Group>
      )}
      <Toaster />
      <CommandPalette />
      <PinnedSessionsPip />
    </>
  )
}

function App() {
  return (
    <DocumentPipProvider>
      <TerminalProvider>
        <ProcessProvider>
          <SessionProvider>
            <AppContent />
          </SessionProvider>
        </ProcessProvider>
      </TerminalProvider>
    </DocumentPipProvider>
  )
}

export default App
