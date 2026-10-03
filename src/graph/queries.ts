import { connectedComponents as graphologyConnectedComponents } from 'graphology-components'
import type { KnowledgeGraph } from './build-graph'

export interface NeighborSet {
  readonly incoming: readonly string[]
  readonly outgoing: readonly string[]
}

/** Direct neighbours of a node, split by edge direction. The node itself is excluded. */
export function getNeighbors(graph: KnowledgeGraph, nodeId: string): NeighborSet {
  return {
    incoming: graph.inNeighbors(nodeId).filter((id) => id !== nodeId),
    outgoing: graph.outNeighbors(nodeId).filter((id) => id !== nodeId),
  }
}

export interface ShortestPathOptions {
  /** Follow edge direction (default false: edges are walked both ways). */
  readonly directed?: boolean
  /** Restrict the search to these nodes, e.g. the currently visible ones. */
  readonly allowedNodeIds?: ReadonlySet<string>
}

/** Unweighted shortest path (BFS). Returns node ids from source to target, or null. */
export function findShortestPath(
  graph: KnowledgeGraph,
  sourceId: string,
  targetId: string,
  options: ShortestPathOptions = {},
): string[] | null {
  if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) return null
  const { directed = false, allowedNodeIds } = options
  const isAllowed = (id: string): boolean => !allowedNodeIds || allowedNodeIds.has(id)
  if (!isAllowed(sourceId) || !isAllowed(targetId)) return null

  const previous = new Map<string, string | null>([[sourceId, null]])
  let frontier = [sourceId]
  while (frontier.length > 0 && !previous.has(targetId)) {
    const next: string[] = []
    for (const current of frontier) {
      const neighbors = directed ? graph.outNeighbors(current) : graph.neighbors(current)
      for (const neighbor of neighbors) {
        if (previous.has(neighbor) || !isAllowed(neighbor)) continue
        previous.set(neighbor, current)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  if (!previous.has(targetId)) return null

  const path: string[] = []
  for (let id: string | null = targetId; id !== null; id = previous.get(id) ?? null) {
    path.push(id)
  }
  return path.reverse()
}

/** Weakly connected components, largest first. */
export function getConnectedComponents(graph: KnowledgeGraph): string[][] {
  return graphologyConnectedComponents(graph).sort((a, b) => b.length - a.length)
}
