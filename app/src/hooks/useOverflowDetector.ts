import { useEffect, useRef } from 'react'

/**
 * Watches an element and toggles the `is-overflowing` class
 * when its content overflows horizontally.
 */
export function useOverflowDetector<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const check = () => {
      el.classList.toggle('is-overflowing', el.scrollWidth > el.clientWidth)
    }

    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  return ref
}
