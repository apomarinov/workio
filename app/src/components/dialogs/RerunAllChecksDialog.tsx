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

interface RerunAllChecksDialogProps {
  checkCount: number
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function RerunAllChecksDialog({
  checkCount,
  onConfirm,
  onClose,
}: RerunAllChecksDialogProps) {
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
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => loading && e.preventDefault()}
        onEscapeKeyDown={(e) => loading && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Re-run all failed checks</DialogTitle>
          <DialogDescription>
            Re-run failed jobs for all{' '}
            <span className="font-medium">{checkCount}</span> failed checks?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading} autoFocus>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Re-run All'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
