import { useEffect, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Toaster } from '@/components/ui/sonner'
import { HomePage } from './components/HomePage'
import { SessionChat } from './components/SessionChat'
import { Sidebar } from './components/Sidebar'
import { Terminal } from './components/Terminal'
import { SessionProvider, useSessionContext } from './context/SessionContext'
import { TerminalProvider, useTerminalContext } from './context/TerminalContext'
import { useBrowserNotification } from './hooks/useBrowserNotification'
import { useSocket } from './hooks/useSocket'
import type { HookEvent } from './types'

function AppContent() {
  const { terminals, loading, activeTerminal, selectTerminal } =
    useTerminalContext()
  const { activeSessionId } = useSessionContext()
  const { subscribe } = useSocket()
  const { notify } = useBrowserNotification()
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>()

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
      const terminal = terminals.find(
        (t) => t.id === data.terminal_id || t.cwd === data.project_path,
      )
      const terminalName =
        terminal?.name || terminal?.cwd || data.project_path || 'Claude'

      if (data.status === 'permission_needed') {
        // Play notification sound
        const audio = new Audio('/audio/permissions.mp3')
        audio.volume = 0.5
        audio.play().catch(() => {})

        // Show browser notification
        notify(`⚠️ Permission Required`, {
          body: `${terminalName} needs permissions`,
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
        // Play done sound
        const audio = new Audio('/audio/done.mp3')
        audio.play().catch(() => {})

        // Show browser notification
        notify(`✅ Done`, {
          body: `${terminalName} has finished`,
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
  }, [subscribe, notify, terminals, selectTerminal])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  // Show home page if no terminals
  if (terminals.length === 0) {
    return (
      <>
        <HomePage />
        <Toaster />
      </>
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
        <AppContent />
      </SessionProvider>
    </TerminalProvider>
  )
}

export default App
