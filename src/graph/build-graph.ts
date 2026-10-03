import Graph from 'graphology'
import type { GraphModel, InternalEdge, InternalNode, PositionMap } from '@/types/graph'

/** Attributes kept on the graphology graph: only what layout and Sigma need. */
export interface NodeAttributes {
  label: string
  x: number
  y: number
  size: number
  community: number | null
  isThirdParty: boolean
}

export interface EdgeAttributes {
  relation: string
  weight: number
  size: number
}

export type KnowledgeGraph = Graph<NodeAttributes, EdgeAttributes>

export const MIN_NODE_SIZE = 3
export const MAX_NODE_SIZE = 18
const NODE_SIZE_PER_SQRT_DEGREE = 0.9
const EDGE_SIZE = 1

/** Isolated nodes get MIN_NODE_SIZE, hubs grow with the square root of their degree. */
export function nodeSize(degree: number): number {
  return Math.min(MAX_NODE_SIZE, MIN_NODE_SIZE + NODE_SIZE_PER_SQRT_DEGREE * Math.sqrt(degree))
}

/**
 * Builds the base graph with EVERY node and edge of the model; filters only
 * hide things at render time. Positions are assigned later by applyPositions.
 *
 * Directed because graph.json keeps the true source→target of every edge even
 * though it declares `directed: false`; multi so that two relations between
 * the same pair of nodes can never make construction throw.
 */
export function buildGraph(model: GraphModel): KnowledgeGraph {
  const graph: KnowledgeGraph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true })
  for (const node of model.nodes) {
    graph.addNode(node.id, {
      label: node.label,
      x: 0,
      y: 0,
      size: nodeSize(node.degree),
      community: node.community,
      isThirdParty: node.isThirdParty,
    })
  }
  for (const edge of model.edges) {
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      relation: edge.relation,
      weight: edge.weight,
      size: EDGE_SIZE,
    })
  }
  return graph
}

/** Writes positions onto the graph. Ids that are not in the graph are ignored. */
export function applyPositions(graph: KnowledgeGraph, positions: PositionMap): void {
  for (const [id, position] of positions) {
    if (graph.hasNode(id)) graph.mergeNodeAttributes(id, { x: position.x, y: position.y })
  }
}

/** Lookups from ids to the full internal records, built once per model. */
export interface GraphIndex {
  readonly nodeById: ReadonlyMap<string, InternalNode>
  readonly edgeById: ReadonlyMap<string, InternalEdge>
  readonly nodeIdsByCommunity: ReadonlyMap<number, readonly string[]>
}

export function buildGraphIndex(model: GraphModel): GraphIndex {
  const nodeIdsByCommunity = new Map<number, string[]>()
  for (const node of model.nodes) {
    if (node.community === null) continue
    const ids = nodeIdsByCommunity.get(node.community) ?? []
    ids.push(node.id)
    nodeIdsByCommunity.set(node.community, ids)
  }
  return {
    nodeById: new Map(model.nodes.map((node) => [node.id, node])),
    edgeById: new Map(model.edges.map((edge) => [edge.id, edge])),
    nodeIdsByCommunity,
  }
}
