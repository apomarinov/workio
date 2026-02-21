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
import { Toaster } from '@/components/ui/sonner'
import { CommandPalette } from './components/CommandPalette'
import { CreateTerminalModal } from './components/CreateTerminalModal'
import { PinnedSessionsPip } from './components/PinnedSessionsPip'
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
import { useSocket } from './hooks/useSocket'
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
  } = useTerminalContext()
  const { activeSessionId, selectSession, sessions } = useSessionContext()
  const { subscribe } = useSocket()
  const { sendNotification } = useNotifications()
  const { clearSession } = useSessionContext()
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals

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
            {terminals.map((t) => (
              <Terminal
                key={t.id}
                terminalId={t.id}
                isVisible={!activeSessionId && t.id === activeTerminal?.id}
              />
            ))}
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
