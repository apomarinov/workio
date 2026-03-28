import type { SettingsUpdate } from '@domains/settings/schema'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettingsView } from '../SettingsViewContext'

/**
 * Factory for top-level string settings.
 */
export function createTextSetting(
  settingKey: keyof SettingsUpdate,
  opts?: { placeholder?: string },
) {
  return function TextSetting() {
    const { formValues, setSettingsValue, validationErrors } = useSettingsView()
    const value = (formValues[settingKey] as string) ?? ''
    const error = validationErrors[settingKey as string]

    return (
      <div className="flex flex-col items-end gap-1">
        <Input
          type="text"
          placeholder={opts?.placeholder}
          value={value}
          onChange={(e) =>
            setSettingsValue(
              settingKey,
              e.target.value as SettingsUpdate[typeof settingKey],
            )
          }
          className={cn('w-[200px]', error && 'border-destructive')}
        />
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    )
  }
}
