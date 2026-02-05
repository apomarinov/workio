import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface HideAuthorDialogProps {
  author: string
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function HideAuthorDialog({
  author,
  onConfirm,
  onClose,
}: HideAuthorDialogProps) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)

  const handleClose = () => {
    setOpen(false)
    setTimeout(onClose, 300)
  }

  const handleOpenChange = (value: boolean) => {
    if (!value && !loading) {
      handleClose()
    }
  }

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
      handleClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Hide comments</DialogTitle>
          <DialogDescription>
            Hide all comments from <span className="font-medium">{author}</span>
            ?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button disabled={loading} autoFocus onClick={handleConfirm}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Hide'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
