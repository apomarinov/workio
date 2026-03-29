import { GitBranch } from 'lucide-react'
import { BranchDiffPanel } from '@/components/BranchDiffPanel'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
        className="w-[100vw] max-w-none p-2 pt-[max(0.5rem,env(safe-area-inset-top))] rounded-none sm:w-[95vw] sm:max-w-[1500px] sm:p-4 sm:pt-4 sm:rounded-lg h-[100dvh] max-h-none sm:h-[95vh] sm:max-h-[1500px] flex flex-col overflow-hidden"
        showCloseButton
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-sm flex items-center gap-2">
            <GitBranch className="w-3 h-3" />
            {branch}
          </DialogTitle>
        </DialogHeader>

        <BranchDiffPanel terminalId={terminalId} branch={branch} />
      </DialogContent>
    </Dialog>
  )
}
