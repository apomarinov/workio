import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BranchDiffPanel } from '../BranchDiffPanel'

interface BranchCommitsDialogProps {
  open: boolean
  terminalId: number
  branch: string
  onClose: () => void
}

export function BranchCommitsDialog({
  open,
  terminalId,
  branch,
  onClose,
}: BranchCommitsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[95vw] p-4 sm:max-w-[1500px] h-[95vh] max-h-[1500px] flex flex-col overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{branch}</DialogTitle>
        </DialogHeader>

        <BranchDiffPanel terminalId={terminalId} branch={branch} />
      </DialogContent>
    </Dialog>
  )
}
