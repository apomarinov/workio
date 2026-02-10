import { Loader2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'

interface HideAuthorDialogProps {
  author: string
  repo: string
  isHidden: boolean
  isSilenced: boolean
  onSave: (config: {
    hideComments: boolean
    silenceNotifications: boolean
  }) => Promise<void>
  onClose: () => void
}

export function HideAuthorDialog({
  author,
  repo,
  isHidden,
  isSilenced,
  onSave,
  onClose,
}: HideAuthorDialogProps) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [hideComments, setHideComments] = useState(isHidden)
  const [silenceNotifications, setSilenceNotifications] = useState(isSilenced)

  useEffect(() => {
    setHideComments(isHidden)
    setSilenceNotifications(isSilenced)
  }, [isHidden, isSilenced])

  const handleClose = () => {
    setOpen(false)
    setTimeout(onClose, 300)
  }

  const handleOpenChange = (value: boolean) => {
    if (!value && !loading) {
      handleClose()
    }
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      await onSave({ hideComments, silenceNotifications })
      handleClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Configure {author}</DialogTitle>
          <DialogDescription>
            Choose what to filter for{' '}
            <span className="font-medium">{author}</span> in{' '}
            {repo.split('/')[1] || repo}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium">Hide comments</p>
              <p className="text-xs text-muted-foreground">
                Hides comments and suppresses notifications
              </p>
            </div>
            <Switch
              checked={hideComments}
              onCheckedChange={(checked) => {
                setHideComments(checked)
                if (checked) setSilenceNotifications(false)
              }}
            />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium">Silence notifications</p>
              <p className="text-xs text-muted-foreground">
                Comments stay visible, notifications suppressed
              </p>
            </div>
            <Switch
              checked={silenceNotifications || hideComments}
              disabled={hideComments}
              onCheckedChange={(checked) => {
                setSilenceNotifications(checked)
                if (checked) setHideComments(false)
              }}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button disabled={loading} onClick={handleSave}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
