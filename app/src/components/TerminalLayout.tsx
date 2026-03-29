import type {
  LayoutNode,
  LayoutSplit,
  Terminal as TerminalType,
} from '@domains/workspace/schema/terminals'
import { Unplug } from 'lucide-react'
import { useRef } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { updateSizesAtPath } from '@/lib/layout'
import { trpc } from '@/lib/trpc'
import { Terminal } from './Terminal'

interface TerminalLayoutProps {
  terminal: TerminalType
  rootShellId: number
  layout: LayoutNode
  isVisible: boolean
  mountedShells: Set<number>
}

export function TerminalLayout({
  terminal,
  rootShellId,
  layout,
  isVisible,
  mountedShells,
}: TerminalLayoutProps) {
  const { activeShells } = useWorkspaceContext()
  const updateMutation = trpc.workspace.terminals.updateTerminal.useMutation()
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const handleResize = (path: number[], sizes: [number, number]) => {
    const newLayout = updateSizesAtPath(layoutRef.current, path, sizes)
    layoutRef.current = newLayout
    updateMutation.mutate({
      id: terminal.id,
      settings: {
        ...terminal.settings,
        layouts: { ...terminal.settings?.layouts, [rootShellId]: newLayout },
      },
    })
  }

  return (
    <LayoutRenderer
      node={layout}
      terminalId={terminal.id}
      activeShellId={activeShells[terminal.id]}
      isVisible={isVisible}
      mountedShells={mountedShells}
      path={[]}
      onResize={handleResize}
    />
  )
}

function LayoutRenderer({
  node,
  terminalId,
  activeShellId,
  isVisible,
  mountedShells,
  path,
  onResize,
}: {
  node: LayoutNode
  terminalId: number
  activeShellId: number | undefined
  isVisible: boolean
  mountedShells: Set<number>
  path: number[]
  onResize: (path: number[], sizes: [number, number]) => void
}) {
  if (node.type === 'leaf') {
    const isActive = node.shellId === activeShellId
    return (
      <div
        className="relative h-full w-full"
        onMouseDown={() => {
          window.dispatchEvent(
            new CustomEvent('shell-select', {
              detail: { terminalId, shellId: node.shellId },
            }),
          )
        }}
      >
        {mountedShells.has(node.shellId) ? (
          <Terminal
            terminalId={terminalId}
            shellId={node.shellId}
            isVisible={isVisible}
          />
        ) : (
          <div className="absolute cursor-pointer hover:bg-gray-500/10 inset-0 flex flex-col items-center justify-center gap-2 bg-[#1a1a1a]">
            <Unplug className="w-7 h-7 text-muted-foreground/40" />
            <span className="text-sm text-muted-foreground/40 leading-none mt-2">
              Inactive shell disconnected
            </span>
            <span className="text-sm text-muted-foreground/40 leading-none">
              Click to re-attach
            </span>
          </div>
        )}
        {!isActive && (
          <div className="absolute inset-0 pointer-events-none z-10 bg-black/20" />
        )}
      </div>
    )
  }

  return (
    <SplitRenderer
      node={node}
      terminalId={terminalId}
      activeShellId={activeShellId}
      isVisible={isVisible}
      mountedShells={mountedShells}
      path={path}
      onResize={onResize}
    />
  )
}

function SplitRenderer({
  node,
  terminalId,
  activeShellId,
  isVisible,
  mountedShells,
  path,
  onResize,
}: {
  node: LayoutSplit
  terminalId: number
  activeShellId: number | undefined
  isVisible: boolean
  mountedShells: Set<number>
  path: number[]
  onResize: (path: number[], sizes: [number, number]) => void
}) {
  const firstRef = usePanelRef()
  const secondRef = usePanelRef()

  const handleLayoutChanged = () => {
    const firstSize = firstRef.current?.getSize()?.asPercentage
    const secondSize = secondRef.current?.getSize()?.asPercentage
    if (firstSize != null && secondSize != null) {
      onResize(path, [firstSize, secondSize])
    }
  }

  return (
    <Group orientation={node.direction} onLayoutChanged={handleLayoutChanged}>
      <Panel
        panelRef={firstRef}
        defaultSize={`${node.children[0].size}%`}
        minSize="5%"
      >
        <LayoutRenderer
          node={node.children[0].node}
          terminalId={terminalId}
          activeShellId={activeShellId}
          isVisible={isVisible}
          mountedShells={mountedShells}
          path={[...path, 0]}
          onResize={onResize}
        />
      </Panel>
      <Separator
        className={
          node.direction === 'horizontal'
            ? 'panel-resize-handle'
            : 'panel-resize-handle-horizontal'
        }
      />
      <Panel
        panelRef={secondRef}
        defaultSize={`${node.children[1].size}%`}
        minSize="5%"
      >
        <LayoutRenderer
          node={node.children[1].node}
          terminalId={terminalId}
          activeShellId={activeShellId}
          isVisible={isVisible}
          mountedShells={mountedShells}
          path={[...path, 1]}
          onResize={onResize}
        />
      </Panel>
    </Group>
  )
}
