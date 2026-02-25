import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandList,
} from '@/components/ui/command'

// Simple fuzzy filter: requires all search characters to appear in order
function fuzzyFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const searchLower = search.toLowerCase()
  const targets = [value, ...(keywords ?? [])].map((s) => s.toLowerCase())

  for (const target of targets) {
    // Check if search is a substring (best match)
    if (target.includes(searchLower)) {
      return 1
    }

    // Fuzzy: all chars must appear in order
    let searchIdx = 0
    for (const char of target) {
      if (char === searchLower[searchIdx]) {
        searchIdx++
        if (searchIdx === searchLower.length) {
          // Score based on how compact the match is
          return 0.5
        }
      }
    }
  }

  return 0
}

import { cn } from '@/lib/utils'
import { PaletteHeader } from './PaletteHeader'
import { PaletteItem } from './PaletteItem'
import type { PaletteMode } from './types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  modes: Record<string, PaletteMode>
  currentModeId: string
  breadcrumbs: string[] // derived from stack titles
  highlightedId: string | null
  onHighlightChange: (id: string | null) => void
  onBack: () => void
  onBreadcrumbClick: (index: number) => void
  onSearchChange?: (value: string) => void
}

export function CommandPaletteCore({
  open,
  onOpenChange,
  modes,
  currentModeId,
  breadcrumbs,
  highlightedId,
  onHighlightChange,
  onBack,
  onBreadcrumbClick,
  onSearchChange,
}: Props) {
  const mode = modes[currentModeId]

  // Compute derived values (hooks must be called unconditionally)
  const allItems = useMemo(() => {
    if (!mode) return []
    return mode.groups ? mode.groups.flatMap((g) => g.items) : mode.items
  }, [mode])

  const highlightedItem = useMemo(() => {
    return allItems.find((i) => i.id === highlightedId) ?? null
  }, [allItems, highlightedId])

  const canGoBack = breadcrumbs.length > 0

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && canGoBack) {
        e.preventDefault()
        onBack()
        return
      }
      if (e.key === 'ArrowRight' && highlightedItem?.onNavigate) {
        e.preventDefault()
        highlightedItem.onNavigate()
        return
      }
      // Cmd+Enter in certain modes can trigger onNavigate too
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        if (highlightedItem?.onNavigate) {
          highlightedItem.onNavigate()
        }
        return
      }
    },
    [highlightedItem, canGoBack, onBack],
  )

  const handleEscapeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      onOpenChange(false)
    },
    [onOpenChange],
  )

  const handleValueChange = useCallback(
    (id: string) => {
      onHighlightChange(id)
    },
    [onHighlightChange],
  )

  // Early return after hooks
  if (!mode) return null

  const totalItems = mode.groups
    ? mode.groups.reduce((sum, g) => sum + g.items.length, 0)
    : mode.items.length

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-description="Command palette for searching and actions"
          className={cn(
            'fixed left-[50%] top-[20%] z-50 w-full translate-x-[-50%] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 transition-[max-width] duration-150',
            'max-sm:max-w-[95vw]',
            mode.width === 'wide' ? 'max-w-2xl' : 'max-w-xl',
          )}
          onKeyDownCapture={handleKeyDown}
          onEscapeKeyDown={handleEscapeKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">
            Command Palette
          </DialogPrimitive.Title>
          <Command
            key={currentModeId}
            className="bg-transparent"
            value={highlightedId ?? ''}
            onValueChange={handleValueChange}
            filter={fuzzyFilter}
            shouldFilter={mode.shouldFilter !== false}
            loop
          >
            <PaletteHeader
              breadcrumbs={breadcrumbs}
              placeholder={mode.placeholder}
              onBreadcrumbClick={canGoBack ? onBreadcrumbClick : undefined}
              onBack={canGoBack ? onBack : undefined}
              onSearchChange={onSearchChange}
            />
            <CommandList
              className={cn(
                totalItems >= 10 ? 'max-h-[480px]' : 'max-h-[360px]',
              )}
            >
              {mode.loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              ) : mode.groups ? (
                <>
                  <CommandEmpty>
                    {mode.emptyMessage ?? 'No results found.'}
                  </CommandEmpty>
                  {mode.groups.map((group) => (
                    <CommandGroup key={group.heading} heading={group.heading}>
                      {group.items.map((item) => (
                        <PaletteItem key={item.id} item={item} />
                      ))}
                    </CommandGroup>
                  ))}
                </>
              ) : mode.items.length > 0 ? (
                <>
                  <CommandEmpty>
                    {mode.emptyMessage ?? 'No results found.'}
                  </CommandEmpty>
                  <CommandGroup>
                    {mode.items.map((item) => (
                      <PaletteItem key={item.id} item={item} />
                    ))}
                  </CommandGroup>
                </>
              ) : (
                <div className="py-6 text-center text-sm text-zinc-500">
                  {mode.emptyMessage ?? 'No items available'}
                </div>
              )}
            </CommandList>
            {(breadcrumbs.length > 0 || mode.footer) && (
              <div className="flex h-9 items-center border-t border-zinc-700 px-3 text-xs text-zinc-500">
                {breadcrumbs.length > 0 && (
                  <span className="truncate text-zinc-500 mr-auto">
                    {breadcrumbs[breadcrumbs.length - 1]}
                  </span>
                )}
                {mode.footer?.(highlightedItem)}
              </div>
            )}
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
