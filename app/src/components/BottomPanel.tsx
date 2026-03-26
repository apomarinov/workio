import { X } from 'lucide-react'
import { useEffect } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

interface BottomPanelProps {
  visible: boolean
  onClose: () => void
  mobile?: boolean
}

const TABS = ['Logs'] as const
type Tab = (typeof TABS)[number]

export function BottomPanel({ visible, onClose, mobile }: BottomPanelProps) {
  const isMobileQuery = useIsMobile()
  const isMobile = mobile ?? isMobileQuery

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
      <div className="fixed inset-0 z-40 flex flex-col bg-[#1e1e1e]">
        <PanelHeader onClose={onClose} />
        <div className="flex-1 min-h-0 overflow-auto">
          <PanelContent tab="Logs" />
        </div>
      </div>
    )
  }

  return <DesktopPanel onClose={onClose} />
}

function DesktopPanel({ onClose }: { onClose: () => void }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'bottom-panel-layout',
    storage: localStorage,
  })

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
          defaultSize="70%"
          minSize="0px"
          className="pointer-events-none"
        />
        <Separator className="panel-resize-handle-horizontal pointer-events-auto" />
        <Panel
          id="bottom-panel-content"
          defaultSize="30%"
          minSize="10%"
          className="pointer-events-auto"
        >
          <div className="h-full flex flex-col bg-[#1e1e1e] border-t border-zinc-700/50">
            <PanelHeader onClose={onClose} />
            <div className="flex-1 min-h-0 overflow-auto">
              <PanelContent tab="Logs" />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-1 h-[28px] shrink-0 border-b border-zinc-700/50 bg-[#1e1e1e]">
      {/* Left: tabs */}
      <div className="flex items-center min-w-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              'px-1.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
              'text-white border-b border-blue-500',
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      {/* Right: actions */}
      <div className="flex items-center">
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

function PanelContent({ tab }: { tab: Tab }) {
  return (
    <div className="p-3 text-xs text-zinc-500">
      {tab === 'Logs' && <p>Logs will appear here.</p>}
    </div>
  )
}
