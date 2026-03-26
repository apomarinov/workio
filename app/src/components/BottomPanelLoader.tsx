import { lazy, Suspense, useEffect, useState } from 'react'

const BottomPanel = lazy(() =>
  import('./BottomPanel').then((m) => ({ default: m.BottomPanel })),
)

interface BottomPanelLoaderProps {
  mobile?: boolean
}

export function BottomPanelLoader({ mobile }: BottomPanelLoaderProps) {
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = () => {
      setLoaded(true)
      setVisible((v) => !v)
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
      />
    </Suspense>
  )
}
