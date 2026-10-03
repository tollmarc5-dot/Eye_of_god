import type { InternalEdge } from '@/types/graph'
import type { GraphIndex, KnowledgeGraph } from './build-graph'
import { findShortestPath } from './queries'

export type ExpansionDepth = 1 | 2 | 3
export const EXPANSION_DEPTHS: readonly ExpansionDepth[] = [1, 2, 3]
/**
 * Safety limit. Every first-party neighbourhood of the real graph fits (the
 * largest has 57 nodes at depth 3); with third-party code drawn, three hops
 * can reach over a thousand nodes, which would no longer be a neighbourhood.
 */
export const MAX_EXPANSION_NODES = 300

export interface Expansion {
  readonly rootId: string
  readonly depth: ExpansionDepth
  /** Root included. In breadth-first order, so a truncated result is deterministic. */
  readonly nodeIds: ReadonlySet<string>
  /** True when the limit stopped the walk before the requested depth was complete. */
  readonly isTruncated: boolean
  /** Neighbours of the walked nodes that the current view does not draw. */
  readonly hiddenNeighborCount: number
}

export interface ExpansionOptions {
  /** Nodes the walk may enter, i.e. the ones the current filters and scope draw. */
  readonly allowedNodeIds?: ReadonlySet<string>
  readonly maxNodes?: number
}

/**
 * The neighbourhood of a node up to `depth` hops, following edges both ways.
 * Uses graphology adjacency only: the cost depends on the neighbourhood, not
 * on the size of the graph. Never leaves `allowedNodeIds`. Null when the root
 * is unknown or not allowed.
 */
export function expandNeighborhood(
  graph: KnowledgeGraph,
  rootId: string,
  depth: ExpansionDepth,
  options: ExpansionOptions = {},
): Expansion | null {
  const { allowedNodeIds, maxNodes = MAX_EXPANSION_NODES } = options
  const isAllowed = (id: string): boolean => !allowedNodeIds || allowedNodeIds.has(id)
  if (!graph.hasNode(rootId) || !isAllowed(rootId)) return null

  const nodeIds = new Set<string>([rootId])
  const hidden = new Set<string>()
  let frontier = [rootId]
  let isTruncated = false
  for (let hop = 0; hop < depth && frontier.length > 0 && !isTruncated; hop += 1) {
    const next: string[] = []
    for (const current of frontier) {
      for (const neighbor of graph.neighbors(current)) {
        if (nodeIds.has(neighbor)) continue
        if (!isAllowed(neighbor)) {
          hidden.add(neighbor)
          continue
        }
        if (nodeIds.size >= maxNodes) {
          isTruncated = true
          break
        }
        nodeIds.add(neighbor)
        next.push(neighbor)
      }
      if (isTruncated) break
    }
    frontier = next
  }
  return { rootId, depth, nodeIds, isTruncated, hiddenNeighborCount: hidden.size }
}

/** One hop of a path, with the real relations between its two nodes. */
export interface PathStep {
  readonly fromId: string
  readonly toId: string
  /**
   * Every edge between the two nodes. The path ignores direction, so an edge
   * may point against the way the path is walked: see `isForward`.
   */
  readonly edges: readonly InternalEdge[]
  /** True when the first edge goes fromId → toId, as the path is read. */
  readonly isForward: boolean
}

export interface GraphPath {
  /** From origin to destination; a single id when both are the same node. */
  readonly nodeIds: readonly string[]
  readonly edgeIds: ReadonlySet<string>
  readonly steps: readonly PathStep[]
}

function edgesBetween(graph: KnowledgeGraph, index: GraphIndex, fromId: string, toId: string): InternalEdge[] {
  // Forward edges first, so `isForward` reflects them when both directions exist.
  return [...graph.outEdges(fromId, toId), ...graph.outEdges(toId, fromId)]
    .map((edgeId) => index.edgeById.get(edgeId))
    .filter((edge): edge is InternalEdge => edge !== undefined)
}

/**
 * Shortest connection between two nodes (fewest hops, direction ignored),
 * restricted to `allowedNodeIds`. Built on findShortestPath; this only adds
 * the edges that make up each hop. Null when there is no such path.
 */
export function findPath(
  graph: KnowledgeGraph,
  index: GraphIndex,
  fromId: string,
  toId: string,
  allowedNodeIds?: ReadonlySet<string>,
): GraphPath | null {
  const nodeIds = findShortestPath(graph, fromId, toId, { allowedNodeIds })
  if (!nodeIds) return null
  const edgeIds = new Set<string>()
  const steps: PathStep[] = []
  for (let position = 0; position + 1 < nodeIds.length; position += 1) {
    const stepFrom = nodeIds[position] as string
    const stepTo = nodeIds[position + 1] as string
    const edges = edgesBetween(graph, index, stepFrom, stepTo)
    for (const edge of edges) edgeIds.add(edge.id)
    steps.push({ fromId: stepFrom, toId: stepTo, edges, isForward: edges[0]?.source === stepFrom })
  }
  return { nodeIds, edgeIds, steps }
}
