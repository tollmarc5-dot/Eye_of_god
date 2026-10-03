import type { Position, PositionMap } from '@/types/graph'
import type { LayoutRequest } from './force-layout'
import { seedPositions, type LayoutNode } from './seed'

export interface LayoutEdge {
  readonly source: string
  readonly target: string
}

export interface LayoutPlan {
  readonly request: LayoutRequest
  /** Nodes without a cached position: the only ones the layout may move. */
  readonly freeCount: number
}

const ITERATIONS = 300
// Gap between the already laid-out graph and the ring where new nodes start.
const NEW_NODE_MARGIN = 1.15

/** Radius of the smallest origin-centred circle containing every cached node in scope. */
function occupiedRadius(nodes: readonly LayoutNode[], cached: PositionMap): number {
  return nodes.reduce((radius, node) => {
    const position = cached.get(node.id)
    return position ? Math.max(radius, Math.hypot(position.x, position.y)) : radius
  }, 0)
}

/**
 * Turns nodes + cache into a worker request. Identity is the node id: a node
 * found in `cached` keeps its position and is pinned; any other node is
 * seeded (outside the occupied area when there is one) and left free.
 */
export function planLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  cached: PositionMap,
): LayoutPlan {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]))
  const freeNodes = nodes.filter((node) => !cached.has(node.id))
  const seeds = seedPositions(freeNodes, occupiedRadius(nodes, cached) * NEW_NODE_MARGIN)
  const seedById = new Map<string, Position>(
    freeNodes.map((node, index) => [
      node.id,
      { x: seeds[index * 2] ?? 0, y: seeds[index * 2 + 1] ?? 0 },
    ]),
  )

  const positions = new Float32Array(nodes.length * 2)
  const fixed = new Uint8Array(nodes.length)
  nodes.forEach((node, index) => {
    const cachedPosition = cached.get(node.id)
    const position = cachedPosition ?? seedById.get(node.id)
    positions[index * 2] = position?.x ?? 0
    positions[index * 2 + 1] = position?.y ?? 0
    fixed[index] = cachedPosition ? 1 : 0
  })

  const pairs: number[] = []
  for (const edge of edges) {
    const source = indexById.get(edge.source)
    const target = indexById.get(edge.target)
    if (source !== undefined && target !== undefined && source !== target) {
      pairs.push(source, target)
    }
  }

  return {
    request: {
      positions,
      fixed,
      edges: Uint32Array.from(pairs),
      iterations: freeNodes.length > 0 ? ITERATIONS : 0,
    },
    freeCount: freeNodes.length,
  }
}

/**
 * Maps worker output back to ids. Cached positions are returned untouched
 * (same objects), so reusing a cache never drifts through float rounding.
 */
export function toPositionMap(
  nodes: readonly LayoutNode[],
  positions: Float32Array,
  cached: PositionMap = new Map(),
): PositionMap {
  const map = new Map<string, Position>()
  nodes.forEach((node, index) => {
    map.set(
      node.id,
      cached.get(node.id) ?? { x: positions[index * 2] ?? 0, y: positions[index * 2 + 1] ?? 0 },
    )
  })
  return map
}
