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
import { useDialog } from '@/hooks/useDialog'

interface ReplyDialogProps {
  author: string
  quotedBody?: string
  onConfirm: (body: string) => Promise<void>
  onClose: () => void
}

export function ReplyDialog({
  author,
  quotedBody,
  onConfirm,
  onClose,
}: ReplyDialogProps) {
  const { open, loading, handleClose, handleOpenChange, submit } =
    useDialog(onClose)
  const [body, setBody] = useState(() => {
    if (quotedBody) {
      const quoted = quotedBody
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      return `${quoted}\n`
    }
    return `@${author} `
  })

  const handleConfirm = async () => {
    if (!body.trim()) return
    await submit(() => onConfirm(body))
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
