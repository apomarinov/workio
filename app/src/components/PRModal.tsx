import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTerminalContext } from '@/context/TerminalContext'
import { getPRStatusInfo } from '@/lib/pr-status'
import { PRStatusContent } from './PRStatusContent'

export function PRModal({
  prNumber,
  repo,
  onClose,
}: {
  prNumber: number
  repo: string
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  const { githubPRs } = useTerminalContext()
  const pr = githubPRs.find((p) => p.prNumber === prNumber && p.repo === repo)

  if (!pr) return null

  const prInfo = getPRStatusInfo(pr)

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setOpen(false)
      setTimeout(onClose, 300)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-w-[95vw] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0">
              {prInfo.icon({ cls: 'w-4 h-4' })}
            </span>
            <span className="break-all">{pr.prTitle}</span>
            <span className="text-muted-foreground text-sm font-normal">
              #{pr.prNumber}
            </span>
          </DialogTitle>
        </DialogHeader>
        <PRStatusContent
          pr={pr}
          expanded={true}
          hasNewActivity={pr.hasUnreadNotifications}
          fullDiscussion
        />
      </DialogContent>
    </Dialog>
  )
}
