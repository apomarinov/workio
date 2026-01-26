import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { HomePage } from './components/HomePage'
import { Sidebar } from './components/Sidebar'
import {
  TerminalProvider,
  useTerminalContext,
} from './context/TerminalContext'
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
        <div className="flex-1 flex flex-col">
          {activeTerminal ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400">
              <div className="text-center">
                <p className="text-lg mb-2">Terminal Placeholder</p>
                <p className="text-sm">
                  Terminal: {activeTerminal.name || activeTerminal.cwd}
                </p>
                <p className="text-xs mt-1">ID: {activeTerminal.id}</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-500">
              Select a terminal
            </div>
          )}
        </div>
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
