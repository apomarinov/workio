import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDialog } from '@/hooks/useDialog'

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
  const { open, loading, handleClose, handleOpenChange, submit } =
    useDialog(onClose)

  const handleConfirm = () => submit(onConfirm)

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
