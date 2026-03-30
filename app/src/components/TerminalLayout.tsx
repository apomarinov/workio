import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type {
  LayoutNode,
  LayoutSplit,
  Terminal as TerminalType,
} from '@domains/workspace/schema/terminals'
import { GripVertical, Plus, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useModifiersHeld } from '@/hooks/useKeyboardShortcuts'
import {
  getLayoutShellIds,
  moveLeaf,
  swapLeaves,
  updateSizesAtPath,
} from '@/lib/layout'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
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
  const [localLayout, setLocalLayout] = useState(layout)
  const layoutRef = useRef(localLayout)
  layoutRef.current = localLayout

  // Sync from prop when server data changes (e.g. after refetch)
  useEffect(() => {
    setLocalLayout(layout)
  }, [layout])

  // --- Drag mode: Ctrl+Alt held ---
  const { isPaneDragModifierHeld } = useModifiersHeld()
  const dragMode = isPaneDragModifierHeld
  const [draggingShellId, setDraggingShellId] = useState<number | null>(null)

  // --- Persist layout ---
  const persistLayout = (newLayout: LayoutNode) => {
    setLocalLayout(newLayout)
    layoutRef.current = newLayout
    updateMutation.mutate({
      id: terminal.id,
      settings: {
        ...terminal.settings,
        layouts: { ...terminal.settings?.layouts, [rootShellId]: newLayout },
      },
    })
  }

  const handleResize = (path: number[], sizes: [number, number]) => {
    persistLayout(updateSizesAtPath(layoutRef.current, path, sizes))
  }

  // --- DnD ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingShellId(event.active.id as number)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingShellId(null)
    const { active, over } = event
    if (!over) return

    const sourceShellId = active.id as number
    const [targetShellIdStr, zone] = (over.id as string).split(':')
    const targetShellId = Number(targetShellIdStr)

    if (sourceShellId === targetShellId) return

    let newLayout: LayoutNode | null = null
    if (zone === 'center') {
      newLayout = swapLeaves(layoutRef.current, sourceShellId, targetShellId)
    } else {
      const directionMap: Record<string, 'horizontal' | 'vertical'> = {
        left: 'horizontal',
        right: 'horizontal',
        top: 'vertical',
        bottom: 'vertical',
      }
      const positionMap: Record<string, 'before' | 'after'> = {
        left: 'before',
        right: 'after',
        top: 'before',
        bottom: 'after',
      }
      newLayout = moveLeaf(
        layoutRef.current,
        sourceShellId,
        targetShellId,
        directionMap[zone],
        positionMap[zone],
      )
    }

    if (newLayout) {
      persistLayout(newLayout)
    }
  }

  const handleDragCancel = () => {
    setDraggingShellId(null)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <LayoutRenderer
        key={getLayoutShellIds(localLayout).join('-')}
        node={localLayout}
        terminalId={terminal.id}
        activeShellId={activeShells[terminal.id]}
        isVisible={isVisible}
        mountedShells={mountedShells}
        path={[]}
        onResize={handleResize}
        dragMode={dragMode}
        draggingShellId={draggingShellId}
      />
      <DragOverlay dropAnimation={null}>
        {draggingShellId != null && (
          <div className="w-24 h-16 rounded-md bg-zinc-800/90 border border-zinc-600 flex items-center justify-center text-xs text-muted-foreground shadow-lg cursor-grabbing">
            <GripVertical className="w-4 h-4 mr-1" />
            Shell
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// --- Drop zones overlay for a leaf pane ---

function DropZones({
  shellId,
  draggingShellId,
}: {
  shellId: number
  draggingShellId: number | null
}) {
  const isSelf = shellId === draggingShellId

  return (
    <div className="absolute inset-0 z-20 pointer-events-auto">
      <DropZoneRegion
        id={`${shellId}:center`}
        className="absolute inset-[30%]"
        highlightClass="bg-blue-500/20 rounded-md"
        disabled={isSelf}
      />
      <DropZoneRegion
        id={`${shellId}:top`}
        className="absolute top-0 left-0 right-0 h-[30%]"
        highlightClass="border-t-2 border-t-blue-500"
        disabled={isSelf}
      />
      <DropZoneRegion
        id={`${shellId}:bottom`}
        className="absolute bottom-0 left-0 right-0 h-[30%]"
        highlightClass="border-b-2 border-b-blue-500"
        disabled={isSelf}
      />
      <DropZoneRegion
        id={`${shellId}:left`}
        className="absolute top-0 left-0 bottom-0 w-[30%]"
        highlightClass="border-l-2 border-l-blue-500"
        disabled={isSelf}
      />
      <DropZoneRegion
        id={`${shellId}:right`}
        className="absolute top-0 right-0 bottom-0 w-[30%]"
        highlightClass="border-r-2 border-r-blue-500"
        disabled={isSelf}
      />
    </div>
  )
}

function DropZoneRegion({
  id,
  className,
  highlightClass,
  disabled,
}: {
  id: string
  className: string
  highlightClass: string
  disabled: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && !disabled && highlightClass)}
    />
  )
}

// --- Drag handle overlay for a leaf pane ---

function SplitButton({
  position,
  terminalId,
  shellId,
}: {
  position: 'top' | 'bottom' | 'left' | 'right'
  terminalId: number
  shellId: number
}) {
  const isVertical = position === 'top' || position === 'bottom'
  const positionClass = {
    top: 'bottom-full rounded-b-none left-1/2 -translate-x-1/2 mb-[-4px]',
    bottom: 'top-full rounded-t-none left-1/2 -translate-x-1/2 mt-[-4px]',
    left: 'right-full rounded-r-none top-1/2 -translate-y-1/2 mr-[-4px]',
    right: 'left-full rounded-l-none top-1/2 -translate-y-1/2 ml-[-4px]',
  }[position]

  return (
    <button
      type="button"
      className={cn(
        'absolute opacity-0 group-hover/handle:opacity-100 transition-opacity',
        'w-7 h-7 flex items-center justify-center rounded-lg',
        'bg-zinc-800 border border-zinc-600 hover:bg-zinc-700 text-muted-foreground cursor-pointer',
        positionClass,
      )}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('shell-split', {
            detail: {
              terminalId,
              shellId,
              direction: isVertical ? 'vertical' : 'horizontal',
            },
          }),
        )
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Plus className="w-3 h-3" />
    </button>
  )
}

function DragHandle({
  shellId,
  terminalId,
}: {
  shellId: number
  terminalId: number
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: shellId,
  })
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
      <div className="group/handle relative">
        <SplitButton position="top" terminalId={terminalId} shellId={shellId} />
        <SplitButton
          position="bottom"
          terminalId={terminalId}
          shellId={shellId}
        />
        <SplitButton
          position="left"
          terminalId={terminalId}
          shellId={shellId}
        />
        <SplitButton
          position="right"
          terminalId={terminalId}
          shellId={shellId}
        />
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className="relative z-10 cursor-grab active:cursor-grabbing p-3 rounded-lg bg-zinc-800 border border-zinc-600 hover:bg-zinc-700 transition-colors select-none"
        >
          <GripVertical className="w-5 h-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  )
}

// --- Recursive layout renderer ---

function LayoutRenderer({
  node,
  terminalId,
  activeShellId,
  isVisible,
  mountedShells,
  path,
  onResize,
  dragMode,
  draggingShellId,
}: {
  node: LayoutNode
  terminalId: number
  activeShellId: number | undefined
  isVisible: boolean
  mountedShells: Set<number>
  path: number[]
  onResize: (path: number[], sizes: [number, number]) => void
  dragMode: boolean
  draggingShellId: number | null
}) {
  if (node.type === 'leaf') {
    const isActive = node.shellId === activeShellId
    const isDragging = draggingShellId != null
    const isBeingDragged = draggingShellId === node.shellId
    return (
      <div
        className="relative h-full w-full"
        onMouseDown={() => {
          if (!dragMode) {
            window.dispatchEvent(
              new CustomEvent('shell-select', {
                detail: { terminalId, shellId: node.shellId },
              }),
            )
          }
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
        {!isActive && !dragMode && (
          <div className="absolute inset-0 pointer-events-none z-10 bg-black/20" />
        )}
        {dragMode && (!isDragging || isBeingDragged) && (
          <DragHandle shellId={node.shellId} terminalId={terminalId} />
        )}
        {isDragging && !isBeingDragged && (
          <DropZones shellId={node.shellId} draggingShellId={draggingShellId} />
        )}
        {isBeingDragged && (
          <div className="absolute inset-0 z-10 bg-black/40 pointer-events-none" />
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
      dragMode={dragMode}
      draggingShellId={draggingShellId}
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
  dragMode,
  draggingShellId,
}: {
  node: LayoutSplit
  terminalId: number
  activeShellId: number | undefined
  isVisible: boolean
  mountedShells: Set<number>
  path: number[]
  onResize: (path: number[], sizes: [number, number]) => void
  dragMode: boolean
  draggingShellId: number | null
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
          dragMode={dragMode}
          draggingShellId={draggingShellId}
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
          dragMode={dragMode}
          draggingShellId={draggingShellId}
        />
      </Panel>
    </Group>
  )
}
