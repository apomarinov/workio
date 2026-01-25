import { useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { ActiveClaudeSessions } from './ActiveClaudeSessions'

interface HomePageProps {
  onCreateSession: (cwd: string, name?: string) => Promise<void>
}

export function HomePage({ onCreateSession }: HomePageProps) {
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    try {
      await onCreateSession(cwd.trim(), name.trim() || undefined)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  const handleSelectPath = (path: string) => {
    setCwd(path)
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Terminal Sessions</h1>
          <p className="text-muted-foreground">Create your first session to get started</p>
        </div>

        <ActiveClaudeSessions onSelectPath={handleSelectPath} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="cwd" className="text-sm font-medium">
              Project Path
            </label>
            <div className="relative">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="cwd"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Session Name (optional)
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>

          <Button
            type="submit"
            disabled={creating || !cwd.trim()}
            className="w-full cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Creating...' : 'Create Session'}
          </Button>
        </form>
      </div>
    </div>
  )
}
