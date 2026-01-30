import { useEffect, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Toaster } from '@/components/ui/sonner'
import { SessionChat } from './components/SessionChat'
import { Sidebar } from './components/Sidebar'
import { Terminal } from './components/Terminal'
import { KeyMapProvider } from './context/KeyMapContext'
import { SessionProvider, useSessionContext } from './context/SessionContext'
import { TerminalProvider, useTerminalContext } from './context/TerminalContext'
import { useBrowserNotification } from './hooks/useBrowserNotification'
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
  const { terminals, loading, activeTerminal, selectTerminal } =
    useTerminalContext()
  const { activeSessionId, selectSession, sessions } = useSessionContext()
  const { subscribe } = useSocket()
  const { notify } = useBrowserNotification()
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>()

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
        session?.latest_user_message ||
        terminal?.name ||
        terminal?.cwd ||
        data.project_path ||
        'Claude'

      if (data.status === 'permission_needed') {
        const title = session?.name || 'Permission Required'

        notify(`⚠️ ${title}`, {
          body: `"${terminalName}" needs permissions`,
          audio: '/audio/permissions.mp3',
          audioVolume: 0.5,
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
        const title = session?.name || 'Done'

        notify(`✅ ${title}`, {
          body: `"${terminalName}" has finished`,
          audio: '/audio/done.mp3',
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
  }, [subscribe, notify, terminals, selectTerminal, sessions])

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
          {activeSessionId ? (
            <SessionChat />
          ) : (
            <Terminal
              key={activeTerminal?.id ?? 'none'}
              terminalId={activeTerminal?.id ?? null}
            />
          )}
        </Panel>
      </Group>
      <Toaster />
    </>
  )
}

function App() {
  return (
    <TerminalProvider>
      <SessionProvider>
        <KeyMapProvider>
          <AppContent />
        </KeyMapProvider>
      </SessionProvider>
    </TerminalProvider>
  )
}

export default App
