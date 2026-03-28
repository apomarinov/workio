import type { PreferredIDE } from '@domains/settings/schema'
import { CursorIcon, VSCodeIcon } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsView } from '../SettingsViewContext'

export function PreferredIDESetting() {
  const { formValues, setSettingsValue } = useSettingsView()
  const value = (formValues.preferred_ide ?? 'cursor') as PreferredIDE

  return (
    <Select
      value={value}
      onValueChange={(v) =>
        setSettingsValue('preferred_ide', v as PreferredIDE)
      }
    >
      <SelectTrigger className="w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="cursor">
          <span className="flex items-center gap-2">
            <CursorIcon className="w-4 h-4 text-muted-foreground" />
            Cursor
          </span>
        </SelectItem>
        <SelectItem value="vscode">
          <span className="flex items-center gap-2">
            <VSCodeIcon className="w-4 h-4 text-muted-foreground" />
            VS Code
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
