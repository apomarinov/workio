import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { mergePR } from '@/lib/api'
import type { PRCheckStatus } from '../../shared/types'

interface MergePRModalProps {
  open: boolean
  pr: PRCheckStatus
  onClose: () => void
  onSuccess?: () => void
}

export function MergePRModal({
  open,
  pr,
  onClose,
  onSuccess,
}: MergePRModalProps) {
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>(
    'squash',
  )
  const [loading, setLoading] = useState(false)
  const mergeButtonRef = useRef<HTMLButtonElement>(null)

  const handleMerge = async () => {
    const [owner, repo] = pr.repo.split('/')
    setLoading(true)
    try {
      await mergePR(owner, repo, pr.prNumber, mergeMethod)
      toast.success('PR merged successfully')
      onClose()
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge PR')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          mergeButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Merge Pull Request</DialogTitle>
          <DialogDescription>Merge "{pr.prTitle}"?</DialogDescription>
        </DialogHeader>
        <Select
          value={mergeMethod}
          onValueChange={(v) =>
            setMergeMethod(v as 'merge' | 'squash' | 'rebase')
          }
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
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button ref={mergeButtonRef} onClick={handleMerge} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
