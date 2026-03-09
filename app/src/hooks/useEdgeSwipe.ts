import { type RefObject, useEffect, useRef } from 'react'

export function useEdgeSwipe(options: {
  enabled: boolean
  ref?: RefObject<HTMLElement | null>
  direction?: 'left' | 'right'
  onSwipeRight?: () => void
  onSwipeLeft?: () => void
  edgeZone?: number
  minSwipe?: number
  maxYDrift?: number
  threshold?: number
}) {
  const {
    enabled,
    ref,
    direction = 'left',
    onSwipeRight,
    onSwipeLeft,
    edgeZone = 30,
    minSwipe = 50,
    maxYDrift = 80,
    threshold = 0.4,
  } = options

  const swipeRightRef = useRef(onSwipeRight)
  swipeRightRef.current = onSwipeRight
  const swipeLeftRef = useRef(onSwipeLeft)
  swipeLeftRef.current = onSwipeLeft

  useEffect(() => {
    if (!enabled) return

    let startX = 0
    let startY = 0
    let fromEdge = false
    let tracking = false
    let swiping = false
    let edgeOffset = 0
    let pendingTimer = 0
    // Track recent positions over a time window for reliable velocity
    const history: { x: number; t: number }[] = []

    const cancelPending = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = 0
      }
    }

    const getEl = () => ref?.current ?? null

    // Clear all inline overrides so CSS classes take full control again
    const clearInline = (el: HTMLElement) => {
      el.style.transition = ''
      el.style.transform = ''
      el.style.translate = ''
    }

    const onTouchStart = (e: TouchEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      const t = e.touches[0]
      const screenW = window.innerWidth

      fromEdge =
        direction === 'left'
          ? t.clientX < edgeZone
          : t.clientX > screenW - edgeZone

      const closeHandler =
        direction === 'left' ? swipeLeftRef.current : swipeRightRef.current
      if (fromEdge || closeHandler) {
        cancelPending()
        startX = t.clientX
        startY = t.clientY
        tracking = true
        swiping = false
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)

      if (dy > maxYDrift) {
        const el = getEl()
        if (swiping && el) snapBack(el)
        tracking = false
        swiping = false
        return
      }

      const el = getEl()
      if (!el) return

      if (!swiping) {
        if (Math.abs(dx) < 10) return
        if (dy > Math.abs(dx)) {
          tracking = false
          return
        }
        swiping = true
        // Read visual position BEFORE overriding CSS translate
        const rect = el.getBoundingClientRect()
        edgeOffset =
          direction === 'left' ? startX - rect.right : startX - rect.left
        // Neutralize CSS translate (Tailwind v4 uses `translate` not `transform`
        // for translate-x-* classes) and immediately set transform to match
        // where the element was visually, preventing a jump.
        el.style.transition = 'none'
        el.style.translate = 'none'
        if (direction === 'left') {
          el.style.transform = `translateX(${rect.left}px)`
        } else {
          const naturalLeft = window.innerWidth - el.offsetWidth
          el.style.transform = `translateX(${rect.left - naturalLeft}px)`
        }
      }

      history.push({ x: t.clientX, t: e.timeStamp })
      // Keep only the last 100ms of samples
      while (history.length > 1 && e.timeStamp - history[0].t > 100) {
        history.shift()
      }

      const W = el.offsetWidth
      if (direction === 'left') {
        const rightEdge = t.clientX - edgeOffset
        const tx = Math.max(-W, Math.min(0, rightEdge - W))
        el.style.transform = `translateX(${tx}px)`
      } else {
        const leftEdge = t.clientX - edgeOffset
        const naturalLeft = window.innerWidth - W
        const tx = Math.max(0, Math.min(W, leftEdge - naturalLeft))
        el.style.transform = `translateX(${tx}px)`
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dy > maxYDrift) return

      const el = getEl()
      const onRight = swipeRightRef.current
      const onLeft = swipeLeftRef.current

      if (swiping && el) {
        swiping = false
        const W = el.offsetWidth
        const first = history[0]
        const dt = first ? e.timeStamp - first.t : 0
        const velocity = dt > 0 ? (t.clientX - first.x) / dt : 0 // px/ms
        history.length = 0
        const flick = Math.abs(velocity) > 0.25
        // Flick only completes if its direction matches the gesture direction.
        // A counter-flick (drag right then flick left) overrides distance and snaps back.
        const completing =
          (flick && Math.sign(velocity) === Math.sign(dx)) ||
          (!flick && Math.abs(dx) > W * threshold)

        let callback: (() => void) | undefined
        let finalPx: number

        if (direction === 'left') {
          if (dx > 0 && fromEdge && onRight && completing) {
            callback = onRight
            finalPx = 0
          } else if (dx < 0 && onLeft && completing) {
            callback = onLeft
            finalPx = -W
          } else {
            finalPx = dx > 0 ? -W : 0
          }
        } else {
          if (dx < 0 && fromEdge && onLeft && completing) {
            callback = onLeft
            finalPx = 0
          } else if (dx > 0 && onRight && completing) {
            callback = onRight
            finalPx = W
          } else {
            finalPx = dx < 0 ? W : 0
          }
        }

        // Animate to final position (translate stays 'none', only transform moves)
        el.style.transition = 'transform 300ms ease-in-out'
        el.style.transform =
          finalPx === 0 ? 'translateX(0)' : `translateX(${finalPx}px)`

        const finish = () => {
          pendingTimer = 0
          if (callback) {
            callback()
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                clearInline(el)
              })
            })
          } else {
            // Snap back — animate both translate and transform back to CSS class
            el.style.transition =
              'transform 300ms ease-in-out, translate 300ms ease-in-out'
            el.style.transform = ''
            el.style.translate = ''
            let cleaned = false
            const cleanTransition = () => {
              if (cleaned) return
              cleaned = true
              el.style.transition = ''
            }
            el.addEventListener('transitionend', cleanTransition, {
              once: true,
            })
            setTimeout(cleanTransition, 350)
          }
        }

        let fired = false
        const onTransitionDone = () => {
          if (fired) return
          fired = true
          finish()
        }
        el.addEventListener('transitionend', onTransitionDone, { once: true })
        pendingTimer = window.setTimeout(onTransitionDone, 350)
      } else {
        // No element tracking — fire callbacks based on distance
        if (direction === 'left') {
          if (dx > minSwipe && fromEdge && onRight) onRight()
          else if (dx < -minSwipe && onLeft) onLeft()
        } else {
          if (dx < -minSwipe && fromEdge && onLeft) onLeft()
          else if (dx > minSwipe && onRight) onRight()
        }
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      cancelPending()
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      const el = getEl()
      if (el) clearInline(el)
    }
  }, [enabled, ref, direction, edgeZone, minSwipe, maxYDrift, threshold])
}

function snapBack(el: HTMLElement) {
  // Animate both properties back to CSS class values
  el.style.transition =
    'transform 300ms ease-in-out, translate 300ms ease-in-out'
  el.style.transform = ''
  el.style.translate = ''
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    el.style.transition = ''
  }
  el.addEventListener('transitionend', cleanup, { once: true })
  setTimeout(cleanup, 350)
}
