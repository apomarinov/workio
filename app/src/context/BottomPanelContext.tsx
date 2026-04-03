import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { BottomPanelTab } from '@/components/bottom-panel/BottomPanel'

export interface LogsInitialFilter {
  terminalId?: number
  prName?: string
  service?: string
  category?: string
  failed?: boolean
}

interface BottomPanelContextValue {
  loaded: boolean
  visible: boolean
  tab: BottomPanelTab | undefined
  close: () => void
  logsFilter: LogsInitialFilter | undefined
  clearLogsFilter: () => void
}

const BottomPanelContext = createContext<BottomPanelContextValue | null>(null)

export function BottomPanelProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)
  const [tab, setTab] = useState<BottomPanelTab | undefined>()
  const [logsFilter, setLogsFilter] = useState<LogsInitialFilter | undefined>()
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

  // open-logs always opens (never toggles) and optionally sets a filter
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as LogsInitialFilter | undefined
      setLoaded(true)
      setVisible(true)
      setTab('logs')
      if (detail) {
        setLogsFilter(detail)
      }
    }
    window.addEventListener('open-logs', handler)
    return () => window.removeEventListener('open-logs', handler)
  }, [])

  const clearLogsFilter = () => setLogsFilter(undefined)

  return (
    <BottomPanelContext.Provider
      value={{
        loaded,
        visible,
        tab,
        close: () => setVisible(false),
        logsFilter,
        clearLogsFilter,
      }}
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
