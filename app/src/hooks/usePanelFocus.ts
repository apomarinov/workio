import { useEffect, useRef } from 'react'

/**
 * Tracks whether a panel has focus based on pointer events.
 * Fires `onFocusChange(true)` on mount and when clicking inside,
 * `onFocusChange(false)` when clicking outside or on unmount.
 * Debounced to avoid rapid toggling.
 */
export function usePanelFocus(
  onFocusChange: (focused: boolean) => void,
  { debounce = 100 }: { debounce?: number } = {},
) {
  const ref = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  const onFocusChangeRef = useRef(onFocusChange)
  onFocusChangeRef.current = onFocusChange

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const setFocused = (focused: boolean) => {
      if (focused === focusedRef.current) return
      focusedRef.current = focused
      clearTimeout(timer)
      timer = setTimeout(() => onFocusChangeRef.current(focused), debounce)
    }

    setFocused(true)

    const handler = (e: PointerEvent) => {
      setFocused(!!ref.current?.contains(e.target as Node))
    }
    window.addEventListener('pointerdown', handler)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handler)
      if (focusedRef.current) {
        focusedRef.current = false
        onFocusChangeRef.current(false)
      }
    }
  }, [debounce])

  return ref
}
