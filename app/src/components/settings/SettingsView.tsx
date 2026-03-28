import { Settings } from 'lucide-react'

export function SettingsView() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-[#1a1a1a] text-zinc-400 gap-3">
      <Settings className="w-8 h-8 text-zinc-500" />
      <p className="text-sm">Settings</p>
    </div>
  )
}
