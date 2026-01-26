import { useEffect } from 'react'
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
      <div className="h-full flex bg-zinc-950">
        <Sidebar />
        <Terminal
          key={activeTerminal?.id ?? 'none'}
          terminalId={activeTerminal?.id ?? null}
        />
      </div>
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
