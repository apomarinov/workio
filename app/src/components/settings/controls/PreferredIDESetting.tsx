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
  const { getFormValue, setFormValue } = useSettingsView()
  const value = (getFormValue('preferred_ide') as string) ?? 'cursor'

  return (
    <Select
      value={value}
      onValueChange={(v) => setFormValue('preferred_ide', v)}
    >
      <SelectTrigger className="w-[140px] !bg-[#1a1a1a]">
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
