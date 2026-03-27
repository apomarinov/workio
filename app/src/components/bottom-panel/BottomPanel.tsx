import { ChevronDown, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { usePersistedPanel } from '@/hooks/usePersistedPanel'
import { cn } from '@/lib/utils'
import { LogsProvider } from './tabs/logs/LogsContext'
import { LogsHeaderActions } from './tabs/logs/LogsHeaderActions'
import { LogsView } from './tabs/logs/LogsView'

interface BottomPanelProps {
  visible: boolean
  onClose: () => void
  mobile?: boolean
  initialTab?: BottomPanelTab
}

export const BOTTOM_PANEL_TABS = ['logs'] as const
export type BottomPanelTab = (typeof BOTTOM_PANEL_TABS)[number]

interface TabConfig {
  title: string
  Provider: React.FC<{ children: React.ReactNode }>
  View: React.FC
  HeaderActions: React.FC
}

const TAB_CONFIG: Record<BottomPanelTab, TabConfig> = {
  logs: {
    title: 'Logs',
    Provider: LogsProvider,
    View: LogsView,
    HeaderActions: LogsHeaderActions,
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

  const config = TAB_CONFIG[activeTab]

  if (isMobile) {
    return (
      <config.Provider>
        <div className="fixed inset-0 z-40 flex flex-col bg-sidebar">
          <PanelHeader
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onClose={onClose}
            headerActions={<config.HeaderActions />}
          />
          <div className="flex-1 min-h-0 relative">
            <div className="absolute inset-0">
              <config.View />
            </div>
          </div>
        </div>
      </config.Provider>
    )
  }

  return (
    <config.Provider>
      <DesktopPanel
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={onClose}
        headerActions={<config.HeaderActions />}
        view={<config.View />}
      />
    </config.Provider>
  )
}

function DesktopPanel({
  activeTab,
  onTabChange,
  onClose,
  headerActions,
  view,
}: {
  activeTab: BottomPanelTab
  onTabChange: (tab: BottomPanelTab) => void
  onClose: () => void
  headerActions: React.ReactNode
  view: React.ReactNode
}) {
  const panel = usePersistedPanel({
    id: 'bottom-panel',
    defaultSize: 30,
  })
  const maximized = panel.mode === 'maximized'
  const toggleMaximize = () =>
    panel.setMode((m) => (m === 'maximized' ? 'normal' : 'maximized'))

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
    >
      <Group
        orientation="vertical"
        className="h-full"
        onLayoutChanged={panel.onLayoutChanged}
      >
        <Panel
          id="bottom-panel-spacer"
          panelRef={panel.spacerRef}
          defaultSize={panel.spacerDefaultSize}
          minSize="0px"
          className="pointer-events-none"
        />
        <Separator
          className={cn(
            'panel-resize-handle-horizontal pointer-events-auto',
            maximized && 'hidden',
          )}
        />
        <Panel
          id="bottom-panel-content"
          panelRef={panel.contentRef}
          defaultSize={panel.contentDefaultSize}
          minSize="10%"
          className="pointer-events-auto"
        >
          <div className="h-full flex flex-col bg-sidebar border-t border-zinc-700/50">
            <PanelHeader
              activeTab={activeTab}
              onTabChange={onTabChange}
              onClose={onClose}
              maximized={maximized}
              onToggleMaximize={toggleMaximize}
              headerActions={headerActions}
            />
            <div className="flex-1 min-h-0 relative">
              <div className="absolute inset-0">{view}</div>
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
  headerActions,
}: {
  activeTab: BottomPanelTab
  onTabChange: (tab: BottomPanelTab) => void
  onClose: () => void
  maximized?: boolean
  onToggleMaximize?: () => void
  headerActions?: React.ReactNode
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
      {/* Right: tab actions + panel controls */}
      <div className="flex items-center">
        {headerActions}
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
