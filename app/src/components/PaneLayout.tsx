import type {
  LayoutNode,
  LayoutSplit,
} from '@domains/workspace/schema/terminals'
import type { ReactNode } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'

interface PaneLayoutProps {
  node: LayoutNode
  renderLeaf: (leafId: number, path: number[]) => ReactNode
  onResize?: (path: number[], sizes: [number, number]) => void
}

export function PaneLayout({ node, renderLeaf, onResize }: PaneLayoutProps) {
  return (
    <PaneRenderer
      node={node}
      path={[]}
      renderLeaf={renderLeaf}
      onResize={onResize}
    />
  )
}

function PaneRenderer({
  node,
  path,
  renderLeaf,
  onResize,
}: {
  node: LayoutNode
  path: number[]
  renderLeaf: (leafId: number, path: number[]) => ReactNode
  onResize?: (path: number[], sizes: [number, number]) => void
}) {
  if (node.type === 'leaf') {
    return <>{renderLeaf(node.shellId, path)}</>
  }

  return (
    <SplitPane
      node={node}
      path={path}
      renderLeaf={renderLeaf}
      onResize={onResize}
    />
  )
}

function SplitPane({
  node,
  path,
  renderLeaf,
  onResize,
}: {
  node: LayoutSplit
  path: number[]
  renderLeaf: (leafId: number, path: number[]) => ReactNode
  onResize?: (path: number[], sizes: [number, number]) => void
}) {
  const firstRef = usePanelRef()
  const secondRef = usePanelRef()

  const handleLayoutChanged = () => {
    const firstSize = firstRef.current?.getSize()?.asPercentage
    const secondSize = secondRef.current?.getSize()?.asPercentage
    if (firstSize != null && secondSize != null) {
      onResize?.(path, [firstSize, secondSize])
    }
  }

  return (
    <Group orientation={node.direction} onLayoutChanged={handleLayoutChanged}>
      <Panel
        panelRef={firstRef}
        defaultSize={`${node.children[0].size}%`}
        minSize="5%"
      >
        <PaneRenderer
          node={node.children[0].node}
          path={[...path, 0]}
          renderLeaf={renderLeaf}
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
        <PaneRenderer
          node={node.children[1].node}
          path={[...path, 1]}
          renderLeaf={renderLeaf}
          onResize={onResize}
        />
      </Panel>
    </Group>
  )
}
