import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface PortMappingModalProps {
  open: boolean
  remotePort: number
  onSave: (localPort: number) => void | Promise<void>
  onCancel: () => void
}

export function PortMappingModal({
  open,
  remotePort,
  onSave,
  onCancel,
}: PortMappingModalProps) {
  const [localPort, setLocalPort] = useState(String(remotePort))
  const parsed = Number.parseInt(localPort, 10)
  const isValid = !Number.isNaN(parsed) && parsed >= 1 && parsed <= 65535

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Map remote port {remotePort}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Local port</label>
          <Input
            type="number"
            min={1}
            max={65535}
            value={localPort}
            onChange={(e) => setLocalPort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValid) onSave(parsed)
            }}
            autoFocus
          />
          {isValid && parsed < 1024 && (
            <p className="text-xs text-yellow-500">
              Ports below 1024 may require elevated privileges
            </p>
          )}
          {!isValid && localPort.length > 0 && (
            <p className="text-xs text-destructive">
              Enter a valid port (1-65535)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!isValid} onClick={() => onSave(parsed)}>
            Map
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
