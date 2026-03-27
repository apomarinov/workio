import { lazy, Suspense } from 'react'
import { useBottomPanelContext } from '@/context/BottomPanelContext'

const BottomPanel = lazy(() =>
  import('./bottom-panel/BottomPanel').then((m) => ({
    default: m.BottomPanel,
  })),
)

interface BottomPanelLoaderProps {
  mobile?: boolean
}

export function BottomPanelLoader({ mobile }: BottomPanelLoaderProps) {
  const { loaded, visible, tab, close } = useBottomPanelContext()

  if (!loaded) return null

  return (
    <Suspense fallback={null}>
      <BottomPanel
        visible={visible}
        onClose={close}
        mobile={mobile}
        initialTab={tab}
      />
    </Suspense>
  )
}
