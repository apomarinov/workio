import { Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsView } from '../SettingsViewContext'

export function KeymapSetting() {
  const { openKeymap } = useSettingsView()

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={openKeymap}
    >
      <Keyboard className="w-3.5 h-3.5" />
      Open Keymap
    </Button>
  )
}
