import { Check, Globe, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { toastError } from '@/lib/toastError'
import { useSettings } from '../hooks/useSettings'

export function RemoteAccessModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { settings, updateSettings } = useSettings()
  const [domain, setDomain] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  const tokenPresent = settings?.ngrok?.tokenPresent ?? false

  useEffect(() => {
    if (settings) {
      setDomain(settings.ngrok?.domain ?? '')
      setToken('')
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      const ngrokUpdate: { domain?: string; token?: string } = {
        domain: domain.trim() || undefined,
      }
      // Only send token if user entered a new one
      if (token.trim()) {
        ngrokUpdate.token = token.trim()
      }
      await updateSettings({ ngrok: ngrokUpdate })
      toast.success('Remote access settings saved')
      onOpenChange(false)
    } catch (err) {
      toastError(err, 'Failed to save remote access settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-sidebar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Remote Access
          </DialogTitle>
          <DialogDescription>
            Expose the app via ngrok tunnel. Requires BASIC_AUTH environment
            variable to be set.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              ngrok Domain
            </label>
            <Input
              placeholder="my-app.ngrok-free.app"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              ngrok Auth Token
              {tokenPresent && !token && <Check className='w-3 h-3 text-green-400' />}
            </label>
            <Input
              type="password"
              placeholder={tokenPresent ? '••••••••••••' : 'ngrok authtoken'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
