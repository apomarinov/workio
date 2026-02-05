import { Loader2, Trash2 } from 'lucide-react'
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

interface HiddenAuthorsDialogProps {
  authors: { author: string; repo: string }[]
  onRemove: (author: string) => Promise<void>
  onClose: () => void
}

export function HiddenAuthorsDialog({
  authors,
  onRemove,
  onClose,
}: HiddenAuthorsDialogProps) {
  const [open, setOpen] = useState(true)
  const [removingAuthor, setRemovingAuthor] = useState<string | null>(null)

  const handleClose = () => {
    setOpen(false)
    setTimeout(onClose, 300)
  }

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      handleClose()
    }
  }

  const handleRemove = async (author: string) => {
    setRemovingAuthor(author)
    try {
      await onRemove(author)
    } finally {
      setRemovingAuthor(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Hidden Comment Authors</DialogTitle>
          <DialogDescription>
            Comments from these authors are hidden for this repo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {authors.map((entry) => (
            <div
              key={entry.author}
              className="flex items-center justify-between py-1.5 px-2 rounded bg-sidebar-accent/30"
            >
              <span className="text-sm">{entry.author}</span>
              <button
                type="button"
                onClick={() => handleRemove(entry.author)}
                disabled={removingAuthor === entry.author}
                className="text-muted-foreground/50 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {removingAuthor === entry.author ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
