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
