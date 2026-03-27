import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { usePersistedPanel } from '@/hooks/usePersistedPanel'
import { Sidebar } from './Sidebar'

interface DesktopLayoutProps {
  children: React.ReactNode
}

export function DesktopLayout({ children }: DesktopLayoutProps) {
  const panel = usePersistedPanel({ id: 'sidebar', defaultSize: 18 })

  useEffect(() => {
    const handler = () => {
      panel.setMode((m) => (m === 'minimized' ? 'normal' : 'minimized'))
    }
    window.addEventListener('toggle-sidebar', handler)
    return () => window.removeEventListener('toggle-sidebar', handler)
  }, [panel.setMode])

  return (
    <Group orientation="horizontal" className="h-full bg-zinc-950">
      <Panel
        id="sidebar"
        panelRef={panel.contentRef}
        defaultSize={panel.contentDefaultSize}
        minSize="0%"
        maxSize="50%"
        onResize={panel.onContentResize}
      >
        <Sidebar />
      </Panel>
      <Separator className="panel-resize-handle" />
      <Panel
        id="main"
        panelRef={panel.spacerRef}
        defaultSize={panel.spacerDefaultSize}
      >
        {children}
      </Panel>
    </Group>
  )
}
