import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'

interface EditPRDialogProps {
  open: boolean
  currentTitle: string
  currentBody: string
  onSave: (title: string, body: string) => Promise<void>
  onCancel: () => void
}

export function EditPRDialog({
  open,
  currentTitle,
  currentBody,
  onSave,
  onCancel,
}: EditPRDialogProps) {
  const [title, setTitle] = useState(currentTitle)
  const [body, setBody] = useState(currentBody)
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave(title.trim(), body)
      onCancel()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && !saving && onCancel()}
    >
      <DialogContent
        className="bg-sidebar sm:max-w-2xl"
        showCloseButton={false}
        onPointerDownOutside={(e) => saving && e.preventDefault()}
        onEscapeKeyDown={(e) => saving && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit Pull Request</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pr-title" className="text-sm text-muted-foreground">
              Title
            </label>
            <Input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR title"
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pr-body" className="text-sm text-muted-foreground">
              Description
            </label>
            <textarea
              id="pr-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="PR description (markdown)"
              rows={16}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
