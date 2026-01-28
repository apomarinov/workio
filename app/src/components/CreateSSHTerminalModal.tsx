import { Globe, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { useTerminals } from '../hooks/useTerminals'

interface CreateSSHTerminalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (terminalId: number) => void
}

export function CreateSSHTerminalModal({
  open,
  onOpenChange,
  onCreated,
}: CreateSSHTerminalModalProps) {
  const { createTerminal } = useTerminals()
  const [sshHost, setSSHHost] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedHost = sshHost.trim()
    if (!trimmedHost) {
      toast.error('SSH host is required')
      return
    }

    setCreating(true)
    try {
      const terminal = await createTerminal(
        '~',
        name.trim() || undefined,
        undefined,
        trimmedHost,
      )
      setSSHHost('')
      setName('')
      onOpenChange(false)
      onCreated?.(terminal.id)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create SSH terminal',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-sidebar">
        <DialogHeader>
          <DialogTitle>New SSH Terminal</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="ssh_host" className="text-sm font-medium">
              SSH Host
            </label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="ssh_host"
                type="text"
                value={sshHost}
                onChange={(e) => setSSHHost(e.target.value)}
                placeholder="e.g. hz-1"
                className="pl-10"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Alias from ~/.ssh/config
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="ssh_name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="ssh_name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
            />
          </div>

          <Button type="submit" disabled={creating} className="w-full mt-2">
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
