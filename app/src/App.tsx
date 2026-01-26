import { useEffect, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Toaster } from '@/components/ui/sonner'
import { HomePage } from './components/HomePage'
import { Sidebar } from './components/Sidebar'
import { Terminal } from './components/Terminal'
import { TerminalProvider, useTerminalContext } from './context/TerminalContext'
import { useSocket } from './hooks/useSocket'
import type { HookEvent } from './types'

function AppContent() {
  const { terminals, loading, activeTerminal } = useTerminalContext()
  const { subscribe } = useSocket()
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>()

  const handleSidebarResize = (size: PanelSize) => {
    setSidebarWidth(size.inPixels)
  }

  // Test: subscribe to hook events
  useEffect(() => {
    return subscribe<HookEvent>('hook', (data) => {
      console.log('[App] Hook event:', data)
    })
  }, [subscribe])

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
      <Group orientation="horizontal" className="h-full bg-zinc-950">
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
          <Terminal
            key={activeTerminal?.id ?? 'none'}
            terminalId={activeTerminal?.id ?? null}
          />
        </Panel>
      </Group>
      <Toaster />
    </>
  )
}

function App() {
  return (
    <TerminalProvider>
      <AppContent />
    </TerminalProvider>
  )
}

export default App
