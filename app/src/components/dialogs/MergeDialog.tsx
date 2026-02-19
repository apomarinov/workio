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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'

interface MergeDialogProps {
  prNumber: number
  onConfirm: (method: 'merge' | 'squash' | 'rebase') => Promise<void>
  onClose: () => void
}

export function MergeDialog({
  prNumber,
  onConfirm,
  onClose,
}: MergeDialogProps) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [method, setMethod] = useState<'merge' | 'squash' | 'rebase'>('squash')

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
      await onConfirm(method)
      handleClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
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
          <DialogTitle>Merge pull request</DialogTitle>
          <DialogDescription>
            Merge <span className="font-medium">#{prNumber}</span> into the base
            branch?
          </DialogDescription>
        </DialogHeader>
        <Select
          value={method}
          onValueChange={(v) => setMethod(v as 'merge' | 'squash' | 'rebase')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="squash">Squash and merge</SelectItem>
            <SelectItem value="merge">Create a merge commit</SelectItem>
            <SelectItem value="rebase">Rebase and merge</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading} autoFocus>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
