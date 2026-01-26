import { FolderOpen, Plus, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '../hooks/useSettings'
import { useTerminals } from '../hooks/useTerminals'

export function HomePage() {
  const { createTerminal } = useTerminals()
  const { settings, updateSettings } = useSettings()
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [shell, setShell] = useState('')
  const [creating, setCreating] = useState(false)

  const defaultShell = settings?.default_shell ?? '/bin/bash'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cwd.trim()) return

    setCreating(true)
    try {
      const shellValue = shell.trim() || undefined
      await createTerminal(cwd.trim(), name.trim() || undefined, shellValue)

      // Save shell to settings as default if provided
      if (shellValue) {
        await updateSettings({ default_shell: shellValue })
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create terminal',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Terminals</h1>
          <p className="text-muted-foreground">
            Create your first terminal to get started
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="cwd" className="text-sm font-medium">
              Path <span className="text-red-500">*</span>
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
              Name
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="shell" className="text-sm font-medium">
              Shell
            </label>
            <div className="relative">
              <TerminalSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="shell"
                type="text"
                value={shell}
                onChange={(e) => setShell(e.target.value)}
                placeholder={defaultShell}
                className="pl-10"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={creating || !cwd.trim()}
            className="w-full cursor-pointer mt-2"
          >
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </form>
      </div>
    </div>
  )
}
