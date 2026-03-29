import { ShellPicker } from '@/components/ShellPicker'
import { useSettingsView } from '../SettingsViewContext'

export function ShellSetting() {
  const { getFormValue, setFormValue } = useSettingsView()
  const value = (getFormValue('default_shell') as string) ?? ''

  return (
    <ShellPicker
      value={value}
      onChange={(v) => setFormValue('default_shell', v)}
      className="w-[200px] !bg-[#1a1a1a]"
    />
  )
}
