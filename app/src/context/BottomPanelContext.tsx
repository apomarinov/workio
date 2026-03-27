import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { BottomPanelTab } from '@/components/bottom-panel/BottomPanel'

interface BottomPanelContextValue {
  loaded: boolean
  visible: boolean
  tab: BottomPanelTab | undefined
  close: () => void
}

const BottomPanelContext = createContext<BottomPanelContextValue | null>(null)

export function BottomPanelProvider({ children }: { children: ReactNode }) {
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

  return (
    <BottomPanelContext.Provider
      value={{ loaded, visible, tab, close: () => setVisible(false) }}
    >
      {children}
    </BottomPanelContext.Provider>
  )
}

export function useBottomPanelContext() {
  const ctx = useContext(BottomPanelContext)
  if (!ctx)
    throw new Error(
      'useBottomPanelContext must be used within BottomPanelProvider',
    )
  return ctx
}
