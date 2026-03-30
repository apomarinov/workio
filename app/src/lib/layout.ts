import type {
  LayoutChild,
  LayoutNode,
} from '@domains/workspace/schema/terminals'

/** Replace the leaf matching targetShellId with a split containing it and a new shell. */
export function splitLeaf(
  node: LayoutNode,
  targetShellId: number,
  newShellId: number,
  direction: 'horizontal' | 'vertical',
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.shellId === targetShellId) {
      return {
        type: 'split',
        direction,
        children: [
          { node: { type: 'leaf', shellId: targetShellId }, size: 50 },
          { node: { type: 'leaf', shellId: newShellId }, size: 50 },
        ],
      }
    }
    return node
  }

  return {
    ...node,
    children: node.children.map((child) => ({
      ...child,
      node: splitLeaf(child.node, targetShellId, newShellId, direction),
    })) as [LayoutChild, LayoutChild],
  }
}

/** Remove a leaf and collapse its parent split. Returns null if the root itself was removed. */
export function removeLeaf(
  node: LayoutNode,
  shellId: number,
): LayoutNode | null {
  if (node.type === 'leaf') {
    return node.shellId === shellId ? null : node
  }

  const [first, second] = node.children
  const newFirst = removeLeaf(first.node, shellId)
  const newSecond = removeLeaf(second.node, shellId)

  if (newFirst === null) return second.node
  if (newSecond === null) return first.node

  return {
    ...node,
    children: [
      { ...first, node: newFirst },
      { ...second, node: newSecond },
    ],
  }
}

/** Update the sizes of a split node at the given path. */
export function updateSizesAtPath(
  node: LayoutNode,
  path: number[],
  sizes: [number, number],
): LayoutNode {
  if (node.type !== 'split') return node

  if (path.length === 0) {
    return {
      ...node,
      children: [
        { ...node.children[0], size: sizes[0] },
        { ...node.children[1], size: sizes[1] },
      ],
    }
  }

  const [idx, ...rest] = path
  return {
    ...node,
    children: node.children.map((child, i) =>
      i === idx
        ? { ...child, node: updateSizesAtPath(child.node, rest, sizes) }
        : child,
    ) as [LayoutChild, LayoutChild],
  }
}

/** Collect all shell IDs referenced in a layout tree. */
export function getLayoutShellIds(node: LayoutNode): number[] {
  if (node.type === 'leaf') return [node.shellId]
  return [
    ...getLayoutShellIds(node.children[0].node),
    ...getLayoutShellIds(node.children[1].node),
  ]
}

/** Swap two leaves by shellId. */
export function swapLeaves(
  node: LayoutNode,
  shellIdA: number,
  shellIdB: number,
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.shellId === shellIdA) return { ...node, shellId: shellIdB }
    if (node.shellId === shellIdB) return { ...node, shellId: shellIdA }
    return node
  }
  return {
    ...node,
    children: node.children.map((child) => ({
      ...child,
      node: swapLeaves(child.node, shellIdA, shellIdB),
    })) as [LayoutChild, LayoutChild],
  }
}

/**
 * Move a leaf to a new position relative to a target leaf.
 * Removes the source from its current position and inserts it next to the target.
 * `position` controls whether it goes before (top/left) or after (bottom/right).
 */
export function moveLeaf(
  node: LayoutNode,
  sourceShellId: number,
  targetShellId: number,
  direction: 'horizontal' | 'vertical',
  position: 'before' | 'after',
): LayoutNode | null {
  // 1. Remove source from tree
  const withoutSource = removeLeaf(node, sourceShellId)
  if (!withoutSource) return null

  // 2. Insert source next to target
  const children: [LayoutChild, LayoutChild] =
    position === 'before'
      ? [
          { node: { type: 'leaf', shellId: sourceShellId }, size: 50 },
          { node: { type: 'leaf', shellId: targetShellId }, size: 50 },
        ]
      : [
          { node: { type: 'leaf', shellId: targetShellId }, size: 50 },
          { node: { type: 'leaf', shellId: sourceShellId }, size: 50 },
        ]

  return insertAtLeaf(withoutSource, targetShellId, {
    type: 'split',
    direction,
    children,
  })
}

/** Replace a leaf matching shellId with a replacement node. */
function insertAtLeaf(
  node: LayoutNode,
  shellId: number,
  replacement: LayoutNode,
): LayoutNode {
  if (node.type === 'leaf') {
    return node.shellId === shellId ? replacement : node
  }
  return {
    ...node,
    children: node.children.map((child) => ({
      ...child,
      node: insertAtLeaf(child.node, shellId, replacement),
    })) as [LayoutChild, LayoutChild],
  }
}

/** Get shell IDs that are inside layout trees but NOT the root tab shell. */
export function getChildShellIds(
  layouts: Record<string, LayoutNode>,
): Set<number> {
  const childIds = new Set<number>()
  for (const [rootId, node] of Object.entries(layouts)) {
    for (const id of getLayoutShellIds(node)) {
      if (id !== Number(rootId)) {
        childIds.add(id)
      }
    }
  }
  return childIds
}
