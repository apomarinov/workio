import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettingsView } from '../SettingsViewContext'

export function createTextSetting(
  path: string,
  opts?: { placeholder?: string },
) {
  return function TextSetting() {
    const { getFormValue, setFormValue, validationErrors } = useSettingsView()
    const [local, setLocal] = useState('')
    const error = validationErrors[path]

    useEffect(() => {
      const v = getFormValue(path)
      if (v != null) setLocal(String(v))
    }, [getFormValue])

    return (
      <div className="flex flex-col items-end gap-1">
        <Input
          type="text"
          placeholder={opts?.placeholder}
          value={local}
          onChange={(e) => {
            setLocal(e.target.value)
            setFormValue(path, e.target.value)
          }}
          className={cn(
            'w-[200px] !bg-[#1a1a1a]',
            error && 'border-destructive',
          )}
        />
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    )
  }
}
