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

interface ReplyDialogProps {
  author: string
  onConfirm: (body: string) => Promise<void>
  onClose: () => void
}

export function ReplyDialog({ author, onConfirm, onClose }: ReplyDialogProps) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [body, setBody] = useState(`@${author} `)

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
    if (!body.trim()) return
    setLoading(true)
    try {
      await onConfirm(body)
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
        className="sm:max-w-md"
        showCloseButton={false}
        onPointerDownOutside={(e) => loading && e.preventDefault()}
        onEscapeKeyDown={(e) => loading && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Reply to {author}</DialogTitle>
          <DialogDescription>
            Add a comment to this pull request
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your comment..."
          rows={4}
          className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
          disabled={loading}
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !body.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
