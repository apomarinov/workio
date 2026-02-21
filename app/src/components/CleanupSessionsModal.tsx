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
import { cleanupOldSessions } from '@/lib/api'

interface CleanupSessionsModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const WEEK_OPTIONS = [
  { value: '1', label: '1 week' },
  { value: '2', label: '2 weeks' },
  { value: '4', label: '4 weeks' },
  { value: '8', label: '8 weeks' },
  { value: '12', label: '12 weeks' },
]

export function CleanupSessionsModal({
  open,
  onClose,
  onSuccess,
}: CleanupSessionsModalProps) {
  const [weeks, setWeeks] = useState('4')
  const [loading, setLoading] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const handleCleanup = async () => {
    setLoading(true)
    try {
      const result = await cleanupOldSessions(Number(weeks))
      if (result.deleted > 0) {
        toast.success(
          `Deleted ${result.deleted} old session${result.deleted === 1 ? '' : 's'}`,
        )
      } else {
        toast.info('No sessions older than the selected period')
      }
      onClose()
      onSuccess()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to cleanup sessions',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Cleanup Sessions</DialogTitle>
          <DialogDescription>
            Delete sessions older than the selected period. Favorited sessions
            are excluded.
          </DialogDescription>
        </DialogHeader>
        <Select value={weeks} onValueChange={setWeeks}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEK_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                Older than {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            ref={deleteButtonRef}
            variant="destructive"
            onClick={handleCleanup}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
