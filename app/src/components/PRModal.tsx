import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGitHubContext } from '@/context/GitHubContext'
import { useDialog } from '@/hooks/useDialog'
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
  const { open, handleOpenChange } = useDialog(onClose)
  const { githubPRs } = useGitHubContext()
  const pr = githubPRs.find((p) => p.prNumber === prNumber && p.repo === repo)

  if (!pr) return null

  const prInfo = getPRStatusInfo(pr)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-w-[95vw] max-h-[80vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 min-w-0">
            <span className="flex-shrink-0 mt-0.5">
              {prInfo.icon({ cls: 'w-4 h-4' })}
            </span>
            <span className="break-words min-w-0">
              {pr.prTitle}{' '}
              <span className="text-muted-foreground text-sm font-normal">
                #{pr.prNumber}
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-w-0">
          <PRStatusContent
            pr={pr}
            expanded={true}
            hasNewActivity={pr.hasUnreadNotifications}
            fullDiscussion
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
