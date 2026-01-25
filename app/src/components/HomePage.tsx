import { useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { ActiveClaudeSessions } from './ActiveClaudeSessions'

interface HomePageProps {
  onCreateSession: (cwd: string, name?: string) => Promise<void>
}

export function HomePage({ onCreateSession }: HomePageProps) {
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    setError(null)
    try {
      await onCreateSession(cwd.trim(), name.trim() || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  const handleSelectPath = (path: string) => {
    setCwd(path)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Terminal Sessions</h1>
          <p className="text-zinc-400">Create your first session to get started</p>
        </div>

        <ActiveClaudeSessions onSelectPath={handleSelectPath} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="cwd" className="block text-sm font-medium text-zinc-300 mb-2">
              Project Path
            </label>
            <div className="relative">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                id="cwd"
                disabled={true}
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="w-full pl-10 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-zinc-300 mb-2">
              Session Name (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={creating || !cwd.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            {creating ? 'Creating...' : 'Create Session'}
          </button>
        </form>
      </div>
    </div>
  )
}
