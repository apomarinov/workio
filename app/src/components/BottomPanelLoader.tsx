import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { BottomPanelTab } from './BottomPanel'

const BottomPanel = lazy(() =>
  import('./BottomPanel').then((m) => ({ default: m.BottomPanel })),
)

interface BottomPanelLoaderProps {
  mobile?: boolean
}

export function BottomPanelLoader({ mobile }: BottomPanelLoaderProps) {
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)
  const [tab, setTab] = useState<BottomPanelTab | undefined>()
  const tabRef = useRef(tab)
  tabRef.current = tab

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { tab?: BottomPanelTab }
        | undefined
      setLoaded(true)
      setVisible((v) => {
        if (v && detail?.tab && detail.tab !== tabRef.current) return true
        return !v
      })
      if (detail?.tab) setTab(detail.tab)
    }
    window.addEventListener('toggle-bottom-panel', handler)
    return () => window.removeEventListener('toggle-bottom-panel', handler)
  }, [])

  if (!loaded) return null

  return (
    <Suspense fallback={null}>
      <BottomPanel
        visible={visible}
        onClose={() => setVisible(false)}
        mobile={mobile}
        initialTab={tab}
      />
    </Suspense>
  )
}
