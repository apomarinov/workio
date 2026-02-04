import { ArrowLeft } from 'lucide-react'
import { CommandInput } from '@/components/ui/command'

type Props = {
  breadcrumbs: string[]
  placeholder: string
  onBack?: () => void
}

export function PaletteHeader({ breadcrumbs, placeholder, onBack }: Props) {
  if (breadcrumbs.length === 0) {
    return <CommandInput placeholder={placeholder} autoFocus />
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-700 px-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      {breadcrumbs.map((crumb, i) => (
        <span key={crumb} className="flex items-center gap-2">
          <span className="truncate text-sm text-zinc-500 max-w-[160px]">
            {crumb}
          </span>
          {i < breadcrumbs.length - 1 && (
            <span className="shrink-0 text-zinc-600">/</span>
          )}
        </span>
      ))}
      <span className="shrink-0 text-zinc-600">/</span>
      <CommandInput
        wrapperCls="border-none px-0 min-w-0 flex-1"
        placeholder={placeholder}
        autoFocus
        className="border-0 px-0 focus-visible:ring-0"
      />
    </div>
  )
}
