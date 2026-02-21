import { Plus } from 'lucide-react'
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

import { Terminal } from './components/Terminal'
import { DocumentPipProvider } from './context/DocumentPipContext'
import { useNotifications } from './context/NotificationContext'
import { ProcessProvider } from './context/ProcessContext'
import { SessionProvider, useSessionContext } from './context/SessionContext'
import { TerminalProvider, useTerminalContext } from './context/TerminalContext'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useSocket } from './hooks/useSocket'
import { createShellForTerminal, deleteShell, renameShell } from './lib/api'
import { cn } from './lib/utils'
import type { HookEvent } from './types'

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
    loading,
    activeTerminal,
    selectTerminal,
    selectPreviousTerminal,
    refetch,
  } = useTerminalContext()
  const { activeSessionId, selectSession, sessions } = useSessionContext()
  const { subscribe } = useSocket()
  const { sendNotification } = useNotifications()
  const { clearSession } = useSessionContext()
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals
  const activeTerminalRef = useRef(activeTerminal)
  activeTerminalRef.current = activeTerminal

  // Multi-shell state
  const [activeShells, setActiveShells] = useState<Record<number, number>>({})
  const activeShellsRef = useRef(activeShells)
  activeShellsRef.current = activeShells
  const [tabBar] = useLocalStorage('shell-tabs-bar', true)

  // Clean up stale activeShells entries when terminals/shells change
  useEffect(() => {
    setActiveShells((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [tidStr, shellId] of Object.entries(next)) {
        const tid = Number(tidStr)
        const terminal = terminals.find((t) => t.id === tid)
        if (!terminal || !terminal.shells.some((s) => s.id === shellId)) {
          const main = terminal?.shells.find((s) => s.name === 'main')
          if (main) {
            next[tid] = main.id
          } else {
            delete next[tid]
          }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [terminals])

  const handleCreateShell = async (terminalId: number) => {
    try {
      const shell = await createShellForTerminal(terminalId)
      await refetch()
      setActiveShells((prev) => ({ ...prev, [terminalId]: shell.id }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create shell')
    }
  }

  const handleDeleteShell = async (terminalId: number, shellId: number) => {
    try {
      await deleteShell(shellId)
      await refetch()
      const terminal = terminalsRef.current.find((t) => t.id === terminalId)
      const main = terminal?.shells.find((s) => s.name === 'main')
      if (main) {
        setActiveShells((prev) => ({ ...prev, [terminalId]: main.id }))
        window.dispatchEvent(
          new CustomEvent('shell-select', {
            detail: { terminalId, shellId: main.id },
          }),
        )
      }
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

  // Shell event listeners (dispatched from TerminalItem sidebar)
  useEffect(() => {
    const onSelect = (
      e: CustomEvent<{ terminalId: number; shellId: number }>,
    ) => {
      setActiveShells((prev) => ({
        ...prev,
        [e.detail.terminalId]: e.detail.shellId,
      }))
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
    const onReset = (e: CustomEvent<{ terminalId: number }>) => {
      const terminal = terminalsRef.current.find(
        (t) => t.id === e.detail.terminalId,
      )
      const main = terminal?.shells.find((s) => s.name === 'main')
      if (main)
        setActiveShells((prev) => ({
          ...prev,
          [e.detail.terminalId]: main.id,
        }))
    }

    window.addEventListener('shell-select', onSelect as EventListener)
    window.addEventListener('shell-create', onCreate as EventListener)
    window.addEventListener('shell-delete', onDelete as EventListener)
    window.addEventListener('shell-rename', onRename as EventListener)
    window.addEventListener('shell-reset', onReset as EventListener)
    return () => {
      window.removeEventListener('shell-select', onSelect as EventListener)
      window.removeEventListener('shell-create', onCreate as EventListener)
      window.removeEventListener('shell-delete', onDelete as EventListener)
      window.removeEventListener('shell-rename', onRename as EventListener)
      window.removeEventListener('shell-reset', onReset as EventListener)
    }
  }, [])

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
      const shell = t.shells[index - 1]
      if (shell) {
        setActiveShells((prev) => ({ ...prev, [t.id]: shell.id }))
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
      const currentId = activeShellsRef.current[t.id] ?? t.shells[0]?.id
      const idx = t.shells.findIndex((s) => s.id === currentId)
      const prev = idx > 0 ? t.shells[idx - 1] : t.shells[t.shells.length - 1]
      if (prev) {
        setActiveShells((p) => ({ ...p, [t.id]: prev.id }))
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
      const currentId = activeShellsRef.current[t.id] ?? t.shells[0]?.id
      const idx = t.shells.findIndex((s) => s.id === currentId)
      const next = idx < t.shells.length - 1 ? t.shells[idx + 1] : t.shells[0]
      if (next) {
        setActiveShells((p) => ({ ...p, [t.id]: next.id }))
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

      if (data.status === 'permission_needed') {
        title ||= 'Permission Required'

        sendNotification(`⚠️ ${title}`, {
          body: `"${terminalName}" needs permissions`,
          audio: 'permission',
          onClick: () => {
            if (terminal) {
              selectTerminal(terminal.id)
            }
            window.dispatchEvent(
              new CustomEvent('flash-session', {
                detail: { sessionId: data.session_id },
              }),
            )
          },
        })
      } else if (data.hook_type === 'Stop') {
        title ||= 'Done'

        sendNotification(`✅ ${title}`, {
          body: `"${terminalName}" has finished`,
          audio: 'done',
          onClick: () => {
            if (terminal) {
              selectTerminal(terminal.id)
            }
            window.dispatchEvent(
              new CustomEvent('flash-session', {
                detail: { sessionId: data.session_id },
              }),
            )
          },
        })
      }
    })
  }, [subscribe, sendNotification, terminals, selectTerminal, sessions])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  return (
    <>
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
        <Panel id="main">
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
              const mainShell = t.shells.find((s) => s.name === 'main')
              const activeShellId =
                activeShells[t.id] ?? mainShell?.id ?? t.shells[0]?.id
              const isTermVisible =
                !activeSessionId && t.id === activeTerminal?.id

              return (
                <div
                  key={t.id}
                  className={cn(
                    'absolute inset-0 flex flex-col bg-[#1a1a1a]',
                    !isTermVisible && 'invisible',
                  )}
                >
                  {tabBar && activeShellId != null && (
                    <ShellTabs
                      terminal={t}
                      activeShellId={activeShellId}
                      onSelectShell={(shellId) =>
                        setActiveShells((prev) => ({
                          ...prev,
                          [t.id]: shellId,
                        }))
                      }
                      onCreateShell={() => handleCreateShell(t.id)}
                      onDeleteShell={(shellId) =>
                        handleDeleteShell(t.id, shellId)
                      }
                      onRenameShell={handleRenameShell}
                      className="pr-2 pl-1 bg-[#1a1a1a] border-b border-zinc-800"
                    />
                  )}
                  <div className="relative flex-1 min-h-0">
                    {t.shells.map((shell) => (
                      <Terminal
                        key={shell.id}
                        terminalId={t.id}
                        shellId={shell.id}
                        isVisible={isTermVisible && shell.id === activeShellId}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </Group>
      <Toaster />
      <CommandPalette />
      <PinnedSessionsPip />,
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
