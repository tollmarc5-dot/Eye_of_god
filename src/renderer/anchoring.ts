import type { Aggregate, KnowledgeGraph } from '@/graph'
import type { RendererViewState } from './reducers'

/**
 * Where relations are drawn when communities are collapsed.
 *
 * A collapsed community is drawn on one of its own nodes, the representative.
 * Its other members are not hidden: they shrink to nothing and their relations
 * are drawn from the representative instead ("anchored" to it). Nothing is
 * added to the graph and no node moves, so no relation can appear that does
 * not exist: every drawn segment is a real relation with its ends moved onto
 * the aggregates that hold them.
 */

type AnchoringView = Pick<RendererViewState, 'visibleNodeIds' | 'showEdges' | 'visibleRelations' | 'aggregates'>

export function isNodeHidden(view: Pick<RendererViewState, 'visibleNodeIds'>, nodeId: string): boolean {
  return view.visibleNodeIds !== null && !view.visibleNodeIds.has(nodeId)
}

/** The aggregate a node is drawn into, if its community is collapsed. */
export function aggregateOf(
  graph: KnowledgeGraph,
  aggregates: ReadonlyMap<number, Aggregate> | null,
  nodeId: string,
): Aggregate | undefined {
  if (!aggregates || aggregates.size === 0) return undefined
  const community = graph.getNodeAttribute(nodeId, 'community')
  return community === null ? undefined : aggregates.get(community)
}

/** The node on which a relation end at `nodeId` is drawn: itself, or its aggregate's representative. */
export function drawnEndOf(
  graph: KnowledgeGraph,
  aggregates: ReadonlyMap<number, Aggregate> | null,
  nodeId: string,
): string {
  return aggregateOf(graph, aggregates, nodeId)?.representativeId ?? nodeId
}

/**
 * Whether a relation is drawn at all: relations shown, its type not filtered
 * out, both ends drawn, and not folded inside a single aggregate (where both
 * ends are the same point).
 */
export function isEdgeDrawn(graph: KnowledgeGraph, view: AnchoringView, edgeId: string): boolean {
  if (!view.showEdges) return false
  if (view.visibleRelations !== null && !view.visibleRelations.has(graph.getEdgeAttribute(edgeId, 'relation'))) {
    return false
  }
  const source = graph.source(edgeId)
  const target = graph.target(edgeId)
  if (isNodeHidden(view, source) || isNodeHidden(view, target)) return false
  const sourceAggregate = aggregateOf(graph, view.aggregates, source)
  return sourceAggregate === undefined || sourceAggregate !== aggregateOf(graph, view.aggregates, target)
}

/** The two nodes a relation is drawn between, source first, or null when it is not drawn. */
export function drawnEdgeEnds(
  graph: KnowledgeGraph,
  view: AnchoringView,
  edgeId: string,
): readonly [string, string] | null {
  if (!isEdgeDrawn(graph, view, edgeId)) return null
  return [
    drawnEndOf(graph, view.aggregates, graph.source(edgeId)),
    drawnEndOf(graph, view.aggregates, graph.target(edgeId)),
  ]
}

/**
 * Edge program side: the display data an end is drawn at. `anchor` is what
 * the node reducer set from `drawnEndOf`; an anchor that is not drawn falls
 * back to the node itself rather than to nowhere.
 */
export function anchoredDisplay<Display extends { readonly anchor?: string }>(
  node: Display,
  lookup: (nodeId: string) => Display | undefined,
): Display {
  return (node.anchor ? lookup(node.anchor) : undefined) ?? node
}
