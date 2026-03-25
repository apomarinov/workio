import type { ReactNode } from 'react'
import { MarkdownContent } from '@/components/MarkdownContent'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDialog } from '@/hooks/useDialog'

interface ContentDialogProps {
  author: string | ReactNode
  avatarUrl?: string
  content: string
  onClose: () => void
}

export function ContentDialog({
  author,
  avatarUrl,
  content,
  onClose,
}: ContentDialogProps) {
  const { open, handleOpenChange } = useDialog(onClose)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {avatarUrl && typeof author === 'string' && (
              <img
                src={avatarUrl}
                alt={author}
                className="w-5 h-5 rounded-full"
              />
            )}
            {author}
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm min-w-0">
          <MarkdownContent content={content} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
