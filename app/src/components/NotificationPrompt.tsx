import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface NotificationPromptProps {
  open: boolean
  onAllow: () => void
  onDismiss: () => void
}

export function NotificationPrompt({
  open,
  onAllow,
  onDismiss,
}: NotificationPromptProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Enable Notifications</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Get notified when Claude needs your attention, like permission
            requests or completed tasks.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
          <Button onClick={onAllow}>Enable</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
