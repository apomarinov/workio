import { Settings } from 'lucide-react'
import { useState } from 'react'
import { PushNotificationModal } from '@/components/PushNotificationModal'
import { Button } from '@/components/ui/button'

export function PushNotificationSetting() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setOpen(true)}
      >
        <Settings className="w-4 h-4" />
      </Button>
      <PushNotificationModal open={open} onOpenChange={setOpen} />
    </>
  )
}
