import { useEffect } from 'react'
import { trpc } from '@/lib/trpc'

export function useSleepWakeRevalidation() {
  const utils = trpc.useUtils()

  useEffect(() => {
    const TICK_INTERVAL = 5_000
    const WAKE_THRESHOLD = 10_000
    let lastTick = Date.now()
    const interval = setInterval(() => {
      const now = Date.now()
      const gap = now - lastTick
      lastTick = now
      if (gap > TICK_INTERVAL + WAKE_THRESHOLD) {
        console.log(`[wake] detected wake after ~${Math.round(gap / 1000)}s`)
        utils.invalidate()
      }
    }, TICK_INTERVAL)
    return () => clearInterval(interval)
  }, [utils])
}
