import { useEffect } from 'react'
import { useSWRConfig } from 'swr'

export function useSleepWakeRevalidation() {
  const { mutate } = useSWRConfig()

  useEffect(() => {
    const TICK_INTERVAL = 5_000
    const WAKE_THRESHOLD = 10_000
    let lastTick = Date.now()
    console.log('[wake] sleep detector mounted')
    const interval = setInterval(() => {
      const now = Date.now()
      const gap = now - lastTick
      lastTick = now
      if (gap > TICK_INTERVAL + WAKE_THRESHOLD) {
        console.log(`[wake] detected wake after ~${Math.round(gap / 1000)}s`)
        console.log('[wake] revalidating all SWR data')
        mutate(() => true)
      }
    }, TICK_INTERVAL)
    return () => clearInterval(interval)
  }, [mutate])
}
