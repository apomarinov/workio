import { useState, useEffect } from 'react'
import { useSessions } from './hooks/useSessions'
import { HomePage } from './components/HomePage'
import { Sidebar } from './components/Sidebar'

function App() {
  const { sessions, loading, createSession, deleteSession } = useSessions()
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)

  // Auto-select first session when sessions load
  useEffect(() => {
    if (sessions.length > 0 && activeSessionId === null) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId])

  // Clear active session if it was deleted
  useEffect(() => {
    if (activeSessionId && !sessions.find(s => s.id === activeSessionId)) {
      setActiveSessionId(sessions.length > 0 ? sessions[0].id : null)
    }
  }, [sessions, activeSessionId])

  const handleCreateSession = async (cwd: string, name?: string) => {
    const session = await createSession(cwd, name)
    setActiveSessionId(session.id)
  }

  const handleDeleteSession = async (id: number) => {
    await deleteSession(id)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  // Show home page if no sessions
  if (sessions.length === 0) {
    return <HomePage onCreateSession={handleCreateSession} />
  }

  const activeSession = sessions.find(s => s.id === activeSessionId)

  return (
    <div className="h-full flex bg-zinc-950">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onDeleteSession={handleDeleteSession}
        onCreateSession={handleCreateSession}
      />
      <div className="flex-1 flex flex-col">
        {activeSession ? (
          <div className="flex-1 flex items-center justify-center text-zinc-400">
            <div className="text-center">
              <p className="text-lg mb-2">Terminal Placeholder</p>
              <p className="text-sm">Session: {activeSession.name || activeSession.path}</p>
              <p className="text-xs mt-1">ID: {activeSession.id}</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Select a session
          </div>
        )}
      </div>
    </div>
  )
}

export default App
