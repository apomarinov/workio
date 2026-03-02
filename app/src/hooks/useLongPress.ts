import { useRef } from 'react'

export function useLongPress(
  onLongPress: () => void,
  delay = 500,
): {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      clear()
      return
    }
    firedRef.current = false
    startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      if (navigator.vibrate) navigator.vibrate(10)
      onLongPress()
    }, delay)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (!startPos.current || !timerRef.current) return
    const dx = e.touches[0].clientX - startPos.current.x
    const dy = e.touches[0].clientY - startPos.current.y
    if (dx * dx + dy * dy > 100) {
      clear()
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    clear()
    if (firedRef.current) {
      e.preventDefault()
    }
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}
