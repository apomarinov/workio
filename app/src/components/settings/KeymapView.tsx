import { ArrowLeft, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsView } from './SettingsViewContext'

export function KeymapView() {
  const { closeKeymap } = useSettingsView()

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1a1a1a] z-10">
      <div className="flex items-center gap-2 p-2 border-b border-zinc-700/50">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={closeKeymap}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Keyboard className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Keyboard Shortcuts</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Keymap editor placeholder
      </div>
    </div>
  )
}
