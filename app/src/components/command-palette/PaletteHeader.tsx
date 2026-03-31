import { ArrowLeft } from 'lucide-react'
import { CommandInput } from '@/components/ui/command'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

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

  return (
    <>
      <CommandInput
        placeholder={placeholder}
        autoFocus={!isMobile}
        onValueChange={onSearchChange}
      />
      {breadcrumbs.length > 0 && (
        <div className="flex flex-wrap min-h-[30px] items-center gap-x-1.5 gap-y-0.5 border-b border-zinc-700 px-3 py-1.5">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1
            const handleClick = isLast
              ? onBack
              : onBreadcrumbClick
                ? () => onBreadcrumbClick(i)
                : undefined
            const isClickable = !!handleClick

            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs may have duplicates
                key={`${crumb}-${i}`}
                className="flex items-center gap-1.5 leading-none"
              >
                <button
                  type="button"
                  onClick={handleClick}
                  className={cn(
                    'flex items-center gap-1 text-xs max-w-[250px]',
                    isClickable
                      ? 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                      : 'text-zinc-500 cursor-default',
                  )}
                >
                  {i === 0 && (
                    <ArrowLeft className="w-3 h-3 mt-[1px] min-w-3" />
                  )}
                  <span className="truncate">
                    {breadcrumbs.length === 1 ? 'Home' : crumb}
                  </span>
                </button>
                {!isLast && <span className="shrink-0 text-zinc-600">/</span>}
              </span>
            )
          })}
        </div>
      )}
    </>
  )
}
