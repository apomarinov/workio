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
import { toast } from '@/components/ui/sonner'
import { rerunAllFailedChecks } from '@/lib/api'
import type { PRCheckStatus } from '../../shared/types'

interface RerunChecksModalProps {
  open: boolean
  pr: PRCheckStatus
  onClose: () => void
  onSuccess?: () => void
}

export function RerunChecksModal({
  open,
  pr,
  onClose,
  onSuccess,
}: RerunChecksModalProps) {
  const [loading, setLoading] = useState(false)

  const failedChecks = pr.checks.filter(
    (c) =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== 'NEUTRAL',
  )

  const handleRerun = async () => {
    const [owner, repo] = pr.repo.split('/')
    const checkUrls = failedChecks.map((c) => c.detailsUrl)
    setLoading(true)
    try {
      const result = await rerunAllFailedChecks(
        owner,
        repo,
        pr.prNumber,
        checkUrls,
      )
      toast.success(`Re-running ${result.rerunCount} check(s)`)
      onClose()
      onSuccess?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to re-run checks',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-run Failed Checks</DialogTitle>
          <DialogDescription>
            Re-run {failedChecks.length} failed check
            {failedChecks.length > 1 ? 's' : ''} for "{pr.prTitle}"?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleRerun} disabled={loading} autoFocus>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Re-run All
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
