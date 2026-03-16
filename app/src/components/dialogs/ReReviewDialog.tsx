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

interface ReReviewDialogProps {
  author: string
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function ReReviewDialog({
  author,
  onConfirm,
  onClose,
}: ReReviewDialogProps) {
  const { open, loading, handleClose, handleOpenChange, submit } =
    useDialog(onClose)

  const handleConfirm = () => submit(onConfirm)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={false}
        onPointerDownOutside={(e) => loading && e.preventDefault()}
        onEscapeKeyDown={(e) => loading && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Request re-review</DialogTitle>
          <DialogDescription>
            Ask <span className="font-medium">{author}</span> to review this PR
            again?
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
              'Request review'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
