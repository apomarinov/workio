import { useState, useEffect } from 'react'
import { useTerminals } from './hooks/useTerminals'
import { HomePage } from './components/HomePage'
import { Sidebar } from './components/Sidebar'
import { Toaster } from '@/components/ui/sonner'

function App() {
  const { terminals, loading, createTerminal, deleteTerminal } = useTerminals()
  const [activeTerminalId, setActiveTerminalId] = useState<number | null>(null)

  // Auto-select first terminal when terminals load
  useEffect(() => {
    if (terminals.length > 0 && activeTerminalId === null) {
      setActiveTerminalId(terminals[0].id)
    }
  }, [terminals, activeTerminalId])

  // Clear active terminal if it was deleted
  useEffect(() => {
    if (activeTerminalId && !terminals.find(t => t.id === activeTerminalId)) {
      setActiveTerminalId(terminals.length > 0 ? terminals[0].id : null)
    }
  }, [terminals, activeTerminalId])

  const handleCreateTerminal = async (cwd: string, name?: string) => {
    const terminal = await createTerminal(cwd, name)
    setActiveTerminalId(terminal.id)
  }

  const handleDeleteTerminal = async (id: number) => {
    await deleteTerminal(id)
  }

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
        <HomePage onCreateTerminal={handleCreateTerminal} />
        <Toaster />
      </>
    )
  }

  const activeTerminal = terminals.find(t => t.id === activeTerminalId)

  return (
    <>
      <div className="h-full flex bg-zinc-950">
        <Sidebar
          terminals={terminals}
          activeTerminalId={activeTerminalId}
          onSelectTerminal={setActiveTerminalId}
          onDeleteTerminal={handleDeleteTerminal}
          onCreateTerminal={handleCreateTerminal}
        />
        <div className="flex-1 flex flex-col">
          {activeTerminal ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400">
              <div className="text-center">
                <p className="text-lg mb-2">Terminal Placeholder</p>
                <p className="text-sm">Terminal: {activeTerminal.name || activeTerminal.cwd}</p>
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

export default App
