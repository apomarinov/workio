import { CommandInput } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { useIsMobile } from '../../hooks/useMediaQuery'

type Props = {
  breadcrumbs: string[]
  placeholder: string
  onBreadcrumbClick?: (index: number) => void
  onBack?: () => void
  onSearchChange?: (value: string) => void
}

export function PaletteHeader({
  breadcrumbs,
  placeholder,
  onBreadcrumbClick,
  onBack,
  onSearchChange,
}: Props) {
  const isMobile = useIsMobile()

  if (breadcrumbs.length === 0) {
    return (
      <CommandInput
        placeholder={placeholder}
        autoFocus={!isMobile}
        onValueChange={onSearchChange}
      />
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-700 px-3">
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1
        // Last breadcrumb: clicking goes back one level (onBack)
        // Other breadcrumbs: clicking navigates to that level
        const handleClick = isLast
          ? onBack
          : onBreadcrumbClick
            ? () => onBreadcrumbClick(i)
            : undefined
        const isClickable = !!handleClick

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs may have duplicates
          <span key={`${crumb}-${i}`} className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClick}
              className={cn(
                'truncate text-sm max-w-[160px]',
                isClickable
                  ? 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                  : 'text-zinc-500 cursor-default',
              )}
            >
              {crumb}
            </button>
            {!isLast && <span className="shrink-0 text-zinc-600">/</span>}
          </span>
        )
      })}
      <span className="shrink-0 text-zinc-600">/</span>
      <CommandInput
        wrapperCls="border-none px-0 min-w-0 flex-1"
        placeholder={placeholder}
        autoFocus={!isMobile}
        className="border-0 px-0 focus-visible:ring-0"
        onValueChange={onSearchChange}
      />
    </div>
  )
}
