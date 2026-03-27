import { useEffect } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels'
import { Sidebar } from './Sidebar'

interface DesktopLayoutProps {
  children: React.ReactNode
}

export function DesktopLayout({ children }: DesktopLayoutProps) {
  const sidebarPanelRef = usePanelRef()
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'main-layout',
    storage: localStorage,
  })

  // Listen for toggle-sidebar event from AppKeyboardShortcuts
  useEffect(() => {
    const handler = () => {
      if (sidebarPanelRef.current?.isCollapsed()) {
        sidebarPanelRef.current.expand()
      } else {
        sidebarPanelRef.current?.collapse()
      }
    }
    window.addEventListener('toggle-sidebar', handler)
    return () => window.removeEventListener('toggle-sidebar', handler)
  }, [sidebarPanelRef])

  return (
    <Group
      orientation="horizontal"
      className="h-full bg-zinc-950"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel
        id="sidebar"
        collapsible
        collapsedSize="0px"
        defaultSize="250px"
        minSize="150px"
        maxSize="50%"
        panelRef={sidebarPanelRef}
      >
        <Sidebar />
      </Panel>
      <Separator className="panel-resize-handle" />
      <Panel id="main">{children}</Panel>
    </Group>
  )
}
