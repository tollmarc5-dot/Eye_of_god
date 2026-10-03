import type { InternalEdge, InternalNode } from '@/types/graph'
import type { GraphIndex, KnowledgeGraph } from './build-graph'

/**
 * Direction as seen from the inspected node. Graphify keeps the true
 * source → target of every link, so this is data, not a guess.
 */
export type ConnectionDirection = 'incoming' | 'outgoing' | 'self'

/** One relation of the inspected node, with the node at its other end. */
export interface NodeConnection {
  readonly edge: InternalEdge
  readonly direction: ConnectionDirection
  /** The other end; the inspected node itself for a self-reference. */
  readonly node: InternalNode
}

export interface RelationCount {
  readonly relation: string
  readonly count: number
}

export interface NodeAnalysis {
  readonly connections: readonly NodeConnection[]
  /** Relation types that arrive at / leave the node, most frequent first. */
  readonly incoming: readonly RelationCount[]
  readonly outgoing: readonly RelationCount[]
  readonly incomingCount: number
  readonly outgoingCount: number
  /** Relations from the node to itself; each also counts once in and once out of its degree. */
  readonly selfCount: number
  /** Distinct nodes it is connected to, itself excluded. */
  readonly neighborCount: number
  /** Edges that touch the node; a self-reference is one edge. */
  readonly relationCount: number
}

function countByRelation(connections: readonly NodeConnection[], direction: ConnectionDirection): RelationCount[] {
  const counts = new Map<string, number>()
  for (const connection of connections) {
    if (connection.direction !== direction) continue
    counts.set(connection.edge.relation, (counts.get(connection.edge.relation) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([relation, count]) => ({ relation, count }))
    .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation))
}

/**
 * Everything the inspector shows about a node's relations. Only walks the
 * edges of that node (graphology adjacency), never the whole graph.
 * Returns null for an id that is not in the graph.
 */
export function analyzeNode(graph: KnowledgeGraph, index: GraphIndex, nodeId: string): NodeAnalysis | null {
  if (!graph.hasNode(nodeId)) return null
  const connections: NodeConnection[] = []
  const neighborIds = new Set<string>()
  const add = (edgeId: string, otherId: string, direction: ConnectionDirection): void => {
    const edge = index.edgeById.get(edgeId)
    const node = index.nodeById.get(otherId)
    if (!edge || !node) return
    connections.push({ edge, direction, node })
    if (direction !== 'self') neighborIds.add(otherId)
  }
  graph.forEachOutEdge(nodeId, (edgeId, _attributes, _source, target) => {
    add(edgeId, target, target === nodeId ? 'self' : 'outgoing')
  })
  graph.forEachInEdge(nodeId, (edgeId, _attributes, source) => {
    // A self-reference was already taken from the outgoing side.
    if (source !== nodeId) add(edgeId, source, 'incoming')
  })

  const incoming = countByRelation(connections, 'incoming')
  const outgoing = countByRelation(connections, 'outgoing')
  const total = (counts: readonly RelationCount[]): number =>
    counts.reduce((sum, item) => sum + item.count, 0)
  return {
    connections,
    incoming,
    outgoing,
    incomingCount: total(incoming),
    outgoingCount: total(outgoing),
    selfCount: connections.length - total(incoming) - total(outgoing),
    neighborCount: neighborIds.size,
    relationCount: connections.length,
  }
}

export type ConnectionSort = 'relation' | 'name' | 'degree'

const DIRECTION_ORDER: Readonly<Record<ConnectionDirection, number>> = {
  incoming: 0,
  outgoing: 1,
  self: 2,
}

function byName(a: NodeConnection, b: NodeConnection): number {
  return a.node.label.localeCompare(b.node.label) || (a.edge.id < b.edge.id ? -1 : 1)
}

const COMPARATORS: Readonly<Record<ConnectionSort, (a: NodeConnection, b: NodeConnection) => number>> = {
  relation: (a, b) =>
    DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction] ||
    a.edge.relation.localeCompare(b.edge.relation) ||
    byName(a, b),
  name: byName,
  degree: (a, b) => b.node.degree - a.node.degree || byName(a, b),
}

/** Deterministic order for the connected-nodes list; never mutates its input. */
export function sortConnections(connections: readonly NodeConnection[], sort: ConnectionSort): NodeConnection[] {
  return [...connections].sort(COMPARATORS[sort])
}

export interface ConnectionFilter {
  readonly direction: ConnectionDirection
  readonly relation: string
}

export function filterConnections(
  connections: readonly NodeConnection[],
  filter: ConnectionFilter | null,
): readonly NodeConnection[] {
  if (!filter) return connections
  return connections.filter(
    (connection) => connection.direction === filter.direction && connection.edge.relation === filter.relation,
  )
}
