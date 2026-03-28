import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettingsView } from '../SettingsViewContext'

export function createTextSetting(
  path: string,
  opts?: { placeholder?: string; secretPresent?: string },
) {
  return function TextSetting() {
    const { getFormValue, setFormValue, validationErrors } = useSettingsView()
    const [local, setLocal] = useState('')
    const [touched, setTouched] = useState(false)
    const error = validationErrors[path]

    const isSecretSet =
      opts?.secretPresent && !touched
        ? !!(getFormValue(opts.secretPresent) as boolean)
        : false

    useEffect(() => {
      const v = getFormValue(path)
      if (v != null) setLocal(String(v))
    }, [getFormValue])

    const handleClear = () => {
      setLocal('')
      setTouched(true)
      setFormValue(path, '')
      if (opts?.secretPresent) {
        setFormValue(opts.secretPresent, false)
      }
    }

    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          {isSecretSet && (
            <button
              type="button"
              onClick={handleClear}
              className="flex-shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
              title="Clear"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <Input
            type="text"
            placeholder={isSecretSet ? '••••••••' : opts?.placeholder}
            value={local}
            onChange={(e) => {
              setLocal(e.target.value)
              setTouched(true)
              setFormValue(path, e.target.value)
            }}
            className={cn(
              'w-[200px] !bg-[#1a1a1a]',
              error && 'border-destructive',
            )}
          />
        </div>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    )
  }
}
