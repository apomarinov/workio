import { useEffect } from 'react'

export function useEdgeSwipe(options: {
  enabled: boolean
  onSwipeRight?: () => void
  onSwipeLeft?: () => void
  edgeZone?: number
  minSwipe?: number
  maxYDrift?: number
}) {
  const {
    enabled,
    onSwipeRight,
    onSwipeLeft,
    edgeZone = 30,
    minSwipe = 50,
    maxYDrift = 80,
  } = options

  useEffect(() => {
    if (!enabled) return

    let startX = 0
    let startY = 0
    let fromEdge = false
    let tracking = false

    const onTouchStart = (e: TouchEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      const t = e.touches[0]
      fromEdge = t.clientX < edgeZone
      if (fromEdge || onSwipeLeft) {
        startX = t.clientX
        startY = t.clientY
        tracking = true
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dy > maxYDrift) return

      if (dx > minSwipe && fromEdge && onSwipeRight) {
        onSwipeRight()
      } else if (dx < -minSwipe && onSwipeLeft) {
        onSwipeLeft()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [enabled, onSwipeRight, onSwipeLeft, edgeZone, minSwipe, maxYDrift])
}
