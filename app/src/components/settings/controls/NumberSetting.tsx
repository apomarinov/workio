import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettingsView } from '../SettingsViewContext'

export function createNumberSetting(
  path: string,
  opts?: { min?: number; max?: number; placeholder?: string; unit?: string },
) {
  return function NumberSetting() {
    const { getFormValue, setFormValue, validationErrors } = useSettingsView()
    const [local, setLocal] = useState('')
    const error = validationErrors[path]

    useEffect(() => {
      const v = getFormValue(path)
      if (v != null) setLocal(String(v))
    }, [getFormValue])

    return (
      <div className="flex flex-col items-end gap-1 relative">
        <Input
          type="number"
          min={opts?.min}
          max={opts?.max}
          placeholder={opts?.placeholder}
          value={local}
          onChange={(e) => {
            setLocal(e.target.value)
            const num =
              e.target.value === '' ? undefined : Number(e.target.value)
            setFormValue(path, num)
          }}
          className={cn(
            'w-[120px] text-right !bg-[#1a1a1a] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]',
            error && 'border-destructive',
          )}
        />
        {!error && opts?.unit && (
          <span className="text-xs text-muted-foreground absolute -bottom-3.5">
            {opts.unit}
          </span>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    )
  }
}
