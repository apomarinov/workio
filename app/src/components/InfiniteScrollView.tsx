import { ArrowDown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface InfiniteScrollViewProps {
  /** Total number of items */
  count: number
  /** Render function — receives index, returns the element to display */
  renderItem: (index: number) => React.ReactNode
  /** Called when user scrolls near the top to load older items */
  onLoadMore?: () => void
  /** Whether more items are available to load */
  hasMore?: boolean
  /** Whether a load-more request is in flight */
  isLoading?: boolean
  /** Optional className for the outer container */
  className?: string
}

const SCROLL_THRESHOLD = -100

export function InfiniteScrollView({
  count,
  renderItem,
  onLoadMore,
  hasMore,
  isLoading,
  className,
}: InfiniteScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  // Track scroll position to show/hide "scroll to bottom" button
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      // flex-col-reverse: scrollTop=0 is bottom, negative is scrolled up
      setShowScrollButton(el.scrollTop < SCROLL_THRESHOLD)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // IntersectionObserver on sentinel to trigger load-more
  useEffect(() => {
    const sentinel = sentinelRef.current
    const scrollEl = scrollRef.current
    if (!sentinel || !scrollEl || !hasMore || isLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoading) {
          onLoadMore?.()
        }
      },
      { root: scrollEl, rootMargin: '300px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isLoading, onLoadMore])

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const items = []
  for (let i = 0; i < count; i++) {
    items.push(renderItem(i))
  }

  return (
    <div className={cn('relative h-full w-full', className)}>
      <div
        ref={scrollRef}
        className="h-full w-full overflow-y-auto flex flex-col-reverse"
      >
        {/* flex-col-reverse displays index 0 at the bottom */}
        <table className="w-full border-collapse">
          <tbody>{items}</tbody>
        </table>

        {/* Loading indicator — in reversed flex, this is visually at the top */}
        {isLoading && (
          <div className="flex items-center justify-center py-3 shrink-0">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          </div>
        )}

        {/* Load-more sentinel — in reversed flex, this is visually at the top */}
        {hasMore && !isLoading && (
          <div ref={sentinelRef} className="w-full h-px shrink-0" />
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 flex items-center justify-center w-7 h-7 rounded-full bg-zinc-700/80 hover:bg-zinc-600 text-white shadow-lg transition-colors cursor-pointer z-10"
          title="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
