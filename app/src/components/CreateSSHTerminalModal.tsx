import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import { useTerminals } from '../hooks/useTerminals'
import { getSSHHosts, type SSHHostEntry } from '../lib/api'
import { cn } from '@/lib/utils'

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
  const [hosts, setHosts] = useState<SSHHostEntry[]>([])
  const [loadingHosts, setLoadingHosts] = useState(false)

  useEffect(() => {
    if (open) {
      setLoadingHosts(true)
      getSSHHosts()
        .then(setHosts)
        .catch(() => toast.error('Failed to load SSH hosts'))
        .finally(() => setLoadingHosts(false))
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!sshHost) {
      toast.error('SSH host is required')
      return
    }

    setCreating(true)
    try {
      const terminal = await createTerminal(
        '~',
        name.trim() || undefined,
        undefined,
        sshHost,
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
          <div className="space-y-1">
            <label htmlFor="ssh_host" className="text-sm font-medium">
              SSH Host
            </label>
            <Select value={sshHost} onValueChange={setSSHHost}>
              <SelectTrigger id="ssh_host" className={cn("w-full [&>span]:text-left", sshHost && '!h-12')}>
                <SelectValue
                  placeholder={loadingHosts ? 'Loading...' : 'Select a host'}
                />
              </SelectTrigger>
              <SelectContent>
                {hosts.map((host) => (
                  <SelectItem key={host.alias} value={host.alias}>
                    <div className="flex flex-col">
                      <span>{host.alias}</span>
                      <span className="text-xs text-muted-foreground">
                        {host.user ? `${host.user}@` : ''}
                        {host.hostname}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Hosts from ~/.ssh/config
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

          <Button
            type="submit"
            disabled={creating || !sshHost}
            className="w-full mt-2"
          >
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
