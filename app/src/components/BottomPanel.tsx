import { ChevronDown, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

interface BottomPanelProps {
  visible: boolean
  onClose: () => void
  mobile?: boolean
  initialTab?: BottomPanelTab
}

export const BOTTOM_PANEL_TABS = ['logs'] as const
export type BottomPanelTab = (typeof BOTTOM_PANEL_TABS)[number]
const TAB_CONFIG: Record<BottomPanelTab, { title: string }> = {
  logs: {
    title: 'Logs',
  },
}

export function BottomPanel({
  visible,
  onClose,
  mobile,
  initialTab,
}: BottomPanelProps) {
  const isMobileQuery = useIsMobile()
  const isMobile = mobile ?? isMobileQuery
  const [activeTab, setActiveTab] = useState<BottomPanelTab>('logs')
  const [maximized, setMaximized] = useLocalStorage(
    'bottom-panel-maximized',
    false,
  )
  const prevInitialTab = useRef(initialTab)

  // Sync tab when initialTab changes from the loader
  useEffect(() => {
    if (initialTab && initialTab !== prevInitialTab.current) {
      setActiveTab(initialTab)
    }
    prevInitialTab.current = initialTab
  }, [initialTab])

  // Close on Escape
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, onClose])

  if (!visible) return null

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-sidebar">
        <PanelHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={onClose}
        />
        <div className="flex-1 min-h-0 overflow-auto">
          <PanelContent tab={activeTab} />
        </div>
      </div>
    )
  }

  return (
    <DesktopPanel
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onClose={onClose}
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
    />
  )
}

function DesktopPanel({
  activeTab,
  onTabChange,
  onClose,
  maximized,
  onToggleMaximize,
}: {
  activeTab: BottomPanelTab
  onTabChange: (tab: BottomPanelTab) => void
  onClose: () => void
  maximized: boolean
  onToggleMaximize: () => void
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'bottom-panel-layout',
    storage: localStorage,
  })
  const spacerRef = usePanelRef()
  const contentRef = usePanelRef()

  // Resize panels when maximized changes
  useEffect(() => {
    if (maximized) {
      spacerRef.current?.resize('0%')
      contentRef.current?.resize('100%')
    } else {
      spacerRef.current?.resize('70%')
      contentRef.current?.resize('30%')
    }
  }, [maximized, spacerRef, contentRef])

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
    >
      <Group
        orientation="vertical"
        className="h-full"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel
          id="bottom-panel-spacer"
          panelRef={spacerRef}
          defaultSize="70%"
          minSize="0px"
          className="pointer-events-none"
        />
        <Separator className={cn('panel-resize-handle-horizontal pointer-events-auto', maximized && 'hidden')} />
        <Panel
          id="bottom-panel-content"
          panelRef={contentRef}
          defaultSize="30%"
          minSize="10%"
          className="pointer-events-auto"
        >
          <div className="h-full flex flex-col bg-sidebar border-t border-zinc-700/50">
            <PanelHeader
              activeTab={activeTab}
              onTabChange={onTabChange}
              onClose={onClose}
              maximized={maximized}
              onToggleMaximize={onToggleMaximize}
            />
            <div className="flex-1 min-h-0 overflow-auto">
              <PanelContent tab={activeTab} />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}

function PanelHeader({
  activeTab,
  onTabChange,
  onClose,
  maximized,
  onToggleMaximize,
}: {
  activeTab: BottomPanelTab
  onTabChange: (tab: BottomPanelTab) => void
  onClose: () => void
  maximized?: boolean
  onToggleMaximize?: () => void
}) {
  return (
    <div className="flex items-center justify-between px-1 h-[28px] shrink-0 border-b border-zinc-700/50 bg-sidebar">
      {/* Left: tabs */}
      <div className="flex items-center min-w-0">
        {BOTTOM_PANEL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={cn(
              'px-1.5 py-1 text-[11px] font-medium transition-colors cursor-pointer border-b',
              activeTab === tab
                ? 'text-white border-blue-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300',
            )}
          >
            {TAB_CONFIG[tab].title}
          </button>
        ))}
      </div>
      {/* Right: actions */}
      <div className="flex items-center">
        {onToggleMaximize && (
          <button
            type="button"
            onClick={onToggleMaximize}
            className="flex items-center justify-center w-5 h-5 text-zinc-400 hover:text-white transition-colors cursor-pointer rounded hover:bg-zinc-700/50"
            title={maximized ? 'Restore panel' : 'Maximize panel'}
          >
            <ChevronDown
              className={cn(
                'w-3 h-3 transition-transform',
                !maximized && '-rotate-180',
              )}
            />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 text-zinc-400 hover:text-white transition-colors cursor-pointer rounded hover:bg-zinc-700/50"
          title="Close panel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

function PanelContent({ tab }: { tab: BottomPanelTab }) {
  return (
    <div className="p-3 text-xs text-zinc-500">
      {tab === 'logs' && <p>Logs will appear here.</p>}
    </div>
  )
}
