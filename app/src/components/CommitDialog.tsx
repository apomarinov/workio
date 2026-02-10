import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { commitChanges, getHeadMessage } from '@/lib/api'

interface CommitDialogProps {
  open: boolean
  terminalId: number
  onClose: () => void
  onSuccess?: () => void
}

export function CommitDialog({
  open,
  terminalId,
  onClose,
  onSuccess,
}: CommitDialogProps) {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchingMessage, setFetchingMessage] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // When amend is toggled on, fetch HEAD message
  useEffect(() => {
    if (!amend) return
    let cancelled = false
    setFetchingMessage(true)
    getHeadMessage(terminalId)
      .then((data) => {
        if (!cancelled) {
          setMessage(data.message)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to get HEAD message',
          )
          setAmend(false)
        }
      })
      .finally(() => {
        if (!cancelled) setFetchingMessage(false)
      })
    return () => {
      cancelled = true
    }
  }, [amend, terminalId])

  const handleAmendChange = (checked: boolean) => {
    setAmend(checked)
    if (!checked) {
      setMessage('')
    }
  }

  const handleCommit = async () => {
    setLoading(true)
    try {
      await commitChanges(terminalId, message, amend)
      toast.success(amend ? 'Amended commit' : 'Changes committed')
      onClose()
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to commit')
    } finally {
      setLoading(false)
    }
  }

  const canCommit = amend || !!message.trim()

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="sm:max-w-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          textareaRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
          <DialogDescription>
            Stage all changes and create a commit.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <textarea
            ref={textareaRef}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none"
            rows={10}
            placeholder="Commit message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={amend || loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
                handleCommit()
              }
            }}
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={amend}
              onCheckedChange={(v) => handleAmendChange(v === true)}
              disabled={loading}
              className="w-5 h-5"
            />
            Amend last commit
            {fetchingMessage && (
              <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
            )}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCommit} disabled={!canCommit || loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {amend ? 'Amend' : 'Commit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
