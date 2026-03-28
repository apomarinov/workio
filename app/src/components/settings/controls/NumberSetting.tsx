import type { SettingsUpdate } from '@domains/settings/schema'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettingsView } from '../SettingsViewContext'

/**
 * Factory for number settings that live at a nested path like 'server_config.xxx'.
 * Returns a component that reads/writes the nested value via the form context.
 */
export function createServerConfigNumberSetting(
  configKey: keyof NonNullable<SettingsUpdate['server_config']>,
  opts?: { min?: number; max?: number; placeholder?: string; unit?: string },
) {
  return function ServerConfigNumberSetting() {
    const { formValues, setSettingsValue, validationErrors } = useSettingsView()
    const serverConfig = formValues.server_config
    const value = serverConfig?.[configKey] ?? ''
    const error = validationErrors[`server_config.${configKey}`]

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const num = e.target.value === '' ? undefined : Number(e.target.value)
      setSettingsValue('server_config', {
        ...serverConfig,
        [configKey]: num,
      } as SettingsUpdate['server_config'])
    }

    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-1 items-end">
          <Input
            type="number"
            min={opts?.min}
            max={opts?.max}
            placeholder={opts?.placeholder}
            value={value}
            onChange={handleChange}
            className={cn(
              'w-[120px] text-right',
              error && 'border-destructive',
            )}
          />
          {opts?.unit && (
            <span className="text-xs text-muted-foreground">{opts.unit}</span>
          )}
        </div>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    )
  }
}
