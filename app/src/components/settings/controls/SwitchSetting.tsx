import { Switch } from '@/components/ui/switch'
import { useSettingsView } from '../SettingsViewContext'

export function createSwitchSetting(path: string) {
  return function SwitchSetting() {
    const { getFormValue, setFormValue } = useSettingsView()
    const value = (getFormValue(path) as boolean) ?? false

    return (
      <Switch checked={value} onCheckedChange={(v) => setFormValue(path, v)} />
    )
  }
}
