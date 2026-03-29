import { Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc'
import { TerminalIcon2 } from './icons'

interface ShellPickerProps {
  value: string
  onChange: (value: string) => void
  sshHost?: string
  className?: string
}

export function ShellPicker({
  value,
  onChange,
  sshHost,
  className,
}: ShellPickerProps) {
  const { data, isLoading } = trpc.workspace.system.listShells.useQuery({
    host: sshHost || undefined,
  })
  const shells = data?.shells ?? []
  // Ensure current value has a matching item even before query loads
  const options = value && !shells.includes(value) ? [value, ...shells] : shells

  return (
    <Select value={value} onValueChange={onChange} disabled={isLoading}>
      <SelectTrigger className={className}>
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {!isLoading && (
            <TerminalIcon2 className="w-4 h-4 fill-muted-foreground flex-shrink-0" />
          )}
          <SelectValue placeholder="Select Shell" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {options.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
