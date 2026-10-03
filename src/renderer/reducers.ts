import type { EdgeDisplayData, NodeDisplayData } from 'sigma/types'
import type { Aggregate, EdgeAttributes, KnowledgeGraph, NodeAttributes } from '@/graph'
import { MAX_NODE_SIZE, MIN_NODE_SIZE } from '@/graph/build-graph'
import { CANVAS_THEME } from '@/styles/canvas-theme'
import { communityColor, communityEdgeColor, mutedCommunityColor } from '@/utils/color'
import { aggregateOf as aggregateIn, drawnEndOf, isEdgeDrawn, isNodeHidden } from './anchoring'
import type { EdgeFx } from './programs/flow-edge'
import type { NodeFx } from './programs/glow-node'

export { isNodeHidden }

/** Everything the renderer needs to know about UI state, pushed in from outside. */
export interface RendererViewState {
  readonly selectedNodeId: string | null
  /** null = no filtering, every node is drawn. */
  readonly visibleNodeIds: ReadonlySet<string> | null
  readonly showEdges: boolean
  /** null = every relation type is drawn. */
  readonly visibleRelations: ReadonlySet<string> | null
  /** Community being explored: its inner relations are drawn a little brighter. */
  readonly activeCommunity: number | null
  /** Expansion, path or selected community; while set, it decides what is lit and what is dimmed. */
  readonly highlight: Highlight | null
  /** Collapsed communities by id: their members are drawn as one aggregate. */
  readonly aggregates: ReadonlyMap<number, Aggregate> | null
  /** Community being inspected: its aggregate, when collapsed, carries the selection ring. */
  readonly selectedCommunityId: number | null
}

/**
 * A set of nodes to keep lit while the rest of the graph is dimmed.
 * - expansion / community: every relation between two lit nodes stays drawn normally.
 * - path: only the relations in `edgeIds` are lit, in the interaction colour.
 */
export interface Highlight {
  readonly kind: 'expansion' | 'path' | 'community'
  readonly nodeIds: ReadonlySet<string>
  readonly edgeIds: ReadonlySet<string> | null
}

/** The node being emphasised (hover wins over selection) and its direct neighbours. */
export interface FocusState {
  readonly activeNodeId: string | null
  readonly neighborIds: ReadonlySet<string>
  /** True when the active node is the hovered one rather than the selection. */
  readonly isHover: boolean
}

export const EMPTY_VIEW_STATE: RendererViewState = {
  selectedNodeId: null,
  visibleNodeIds: null,
  showEdges: true,
  visibleRelations: null,
  activeCommunity: null,
  highlight: null,
  aggregates: null,
  selectedCommunityId: null,
}

const NO_NEIGHBORS: ReadonlySet<string> = new Set()
export const NO_FOCUS: FocusState = { activeNodeId: null, neighborIds: NO_NEIGHBORS, isHover: false }

const FOCUS_EDGE_SIZE = 1.6

/** Presence of a node at rest: hubs glow, leaves stay discreet but visible. */
const MIN_REST_GLOW = 0.32
const MAX_REST_GLOW = 0.9
const THIRD_PARTY_GLOW_FACTOR = 0.45
const NEIGHBOR_GLOW_BOOST = 0.25
const NEIGHBOR_SIZE_FACTOR = 1.1
const PATH_NODE_SIZE_FACTOR = 1.18
// Sigma replaces a size of 0 with its default, so "invisible" is a tiny size instead.
export const COLLAPSED_MEMBER_SIZE = 0.001
const AGGREGATE_GLOW = 0.85
const AGGREGATE_SELECTED_SIZE_FACTOR = 1.12
const HOVER_SIZE_FACTOR = 1.22
const SELECTED_SIZE_FACTOR = 1.35
/** Accent passed to the node program: tints the halo; from 0.75 up it adds the ring. */
export const HOVER_ACCENT = 0.5
export const SELECTED_ACCENT = 1

/**
 * Visual intensity from the node size, which already encodes its degree.
 * No new data: the same attribute drives size, brightness and halo.
 */
export function restGlow(size: number, isThirdParty: boolean): number {
  const prominence = Math.min(1, Math.max(0, (size - MIN_NODE_SIZE) / (MAX_NODE_SIZE - MIN_NODE_SIZE)))
  const glow = MIN_REST_GLOW + (MAX_REST_GLOW - MIN_REST_GLOW) * Math.sqrt(prominence)
  return isThirdParty ? glow * THIRD_PARTY_GLOW_FACTOR : glow
}

export function computeFocus(
  graph: KnowledgeGraph,
  view: RendererViewState,
  hoveredNodeId: string | null,
): FocusState {
  const activeNodeId = hoveredNodeId ?? view.selectedNodeId
  if (activeNodeId === null || !graph.hasNode(activeNodeId) || isNodeHidden(view, activeNodeId)) {
    return NO_FOCUS
  }
  return {
    activeNodeId,
    neighborIds: new Set(graph.neighbors(activeNodeId)),
    isHover: hoveredNodeId !== null,
  }
}

/** Edges inside one first-party community carry its tint; everything else stays neutral. */
function restingEdgeColor(
  graph: KnowledgeGraph,
  source: string,
  target: string,
  activeCommunity: number | null,
): string {
  const from = graph.getNodeAttributes(source)
  if (from.isThirdParty || from.community === null) return CANVAS_THEME.edge
  return graph.getNodeAttribute(target, 'community') === from.community
    ? communityEdgeColor(from.community, from.community === activeCommunity)
    : CANVAS_THEME.edge
}

/** How the active (hovered or selected) node relates to the collapsed communities. */
interface FocusCommunities {
  /** Set when the active node is itself the aggregate of a collapsed community. */
  readonly aggregateCommunity: number | null
  /** Collapsed communities that hold a neighbour of the active node. */
  readonly neighborCommunities: ReadonlySet<number>
}

const NO_FOCUS_COMMUNITIES: FocusCommunities = { aggregateCommunity: null, neighborCommunities: new Set() }

type NodeDisplay = Omit<NodeAttributes, 'label'> & Partial<NodeDisplayData> & NodeFx
type EdgeDisplay = EdgeAttributes & Partial<EdgeDisplayData> & EdgeFx

export interface Reducers {
  nodeReducer(nodeId: string, attributes: NodeAttributes): Partial<NodeDisplayData>
  edgeReducer(edgeId: string, attributes: EdgeAttributes): Partial<EdgeDisplayData>
}

/**
 * Per-item styling from view + focus state. Sigma hands each reducer its own
 * copy of the attributes, so they are filled in place: no allocation per
 * node or edge, and the graph itself is never touched.
 */
export function createReducers(
  graph: KnowledgeGraph,
  getView: () => RendererViewState,
  getFocus: () => FocusState,
): Reducers {
  const aggregateOf = (view: RendererViewState, nodeId: string): Aggregate | undefined =>
    aggregateIn(graph, view.aggregates, nodeId)

  // Worked out once per focus object, not once per node.
  const focusCommunityCache = new WeakMap<FocusState, FocusCommunities>()
  const focusCommunities = (view: RendererViewState, focus: FocusState): FocusCommunities => {
    if (focus.activeNodeId === null || !view.aggregates || view.aggregates.size === 0) {
      return NO_FOCUS_COMMUNITIES
    }
    const cached = focusCommunityCache.get(focus)
    if (cached) return cached
    const own = aggregateOf(view, focus.activeNodeId)
    const neighborCommunities = new Set<number>()
    for (const neighborId of focus.neighborIds) {
      const aggregate = aggregateOf(view, neighborId)
      if (aggregate) neighborCommunities.add(aggregate.communityId)
    }
    const result: FocusCommunities = {
      aggregateCommunity: own?.representativeId === focus.activeNodeId ? own.communityId : null,
      neighborCommunities,
    }
    focusCommunityCache.set(focus, result)
    return result
  }

  /**
   * A member of a collapsed community. The representative is drawn as the
   * aggregate, where it already is; the others shrink to nothing and are
   * anchored to it. They are NOT hidden, so relations that leave the community
   * are still drawn — the edge program ends them on the anchor — without a
   * single artificial edge.
   */
  const reduceCollapsed = (
    display: NodeDisplay,
    nodeId: string,
    aggregate: Aggregate,
    view: RendererViewState,
    focus: FocusState,
  ): NodeDisplay => {
    if (nodeId !== aggregate.representativeId) {
      display.size = COLLAPSED_MEMBER_SIZE
      display.label = null
      display.glow = 0
      display.color = CANVAS_THEME.nodeDimmed
      display.anchor = drawnEndOf(graph, view.aggregates, nodeId)
      return display
    }
    const communities = focusCommunities(view, focus)
    const isSelected = view.selectedCommunityId === aggregate.communityId
    const isHovered = focus.isHover && focus.activeNodeId === nodeId
    const isNeighbor = communities.neighborCommunities.has(aggregate.communityId)
    const nodeFocusActive = focus.activeNodeId !== null && communities.aggregateCommunity === null
    display.size = aggregate.size
    display.label = aggregate.label
    display.aggregate = 1
    // A shown path, expansion or community keeps its own communities expanded,
    // so every aggregate still drawn is outside of it.
    if ((view.highlight !== null || (nodeFocusActive && !isNeighbor)) && !isSelected && !isHovered) {
      display.color = CANVAS_THEME.nodeDimmed
      display.label = null
      display.glow = 0
      return display
    }
    display.color = display.isThirdParty
      ? mutedCommunityColor(aggregate.communityId)
      : communityColor(aggregate.communityId)
    display.glow = AGGREGATE_GLOW
    if (isSelected || isHovered) {
      if (isSelected) display.size = aggregate.size * AGGREGATE_SELECTED_SIZE_FACTOR
      display.glow = 1
      display.accent = isSelected ? SELECTED_ACCENT : HOVER_ACCENT
      display.highlighted = true
      display.forceLabel = true
    }
    return display
  }

  return {
    nodeReducer(nodeId, attributes) {
      const display: NodeDisplay = attributes
      const view = getView()
      if (isNodeHidden(view, nodeId)) {
        display.hidden = true
        return display
      }
      const focus = getFocus()
      const aggregate = aggregateOf(view, nodeId)
      if (aggregate) return reduceCollapsed(display, nodeId, aggregate, view, focus)
      const { highlight } = view
      const isSelected = nodeId === view.selectedNodeId
      const isActive = nodeId === focus.activeNodeId
      // With an expansion or a path shown, that set replaces "neighbours of the
      // active node" as what stays lit; hover still answers on its own node.
      const isNeighbor = highlight ? highlight.nodeIds.has(nodeId) : focus.neighborIds.has(nodeId)
      // Hovering an aggregate lights its relations but dims nothing: its
      // neighbours are communities, not the neighbours of one node.
      const dimsOthers =
        highlight !== null ||
        (focus.activeNodeId !== null && focusCommunities(view, focus).aggregateCommunity === null)
      if (dimsOthers && !isActive && !isNeighbor && !isSelected) {
        display.color = CANVAS_THEME.nodeDimmed
        display.label = null
        display.glow = 0
        return display
      }
      const glow = restGlow(attributes.size, attributes.isThirdParty)
      display.color = attributes.isThirdParty
        ? mutedCommunityColor(attributes.community)
        : communityColor(attributes.community)
      if (isSelected || isActive) {
        // "Identified by the system": bigger, brighter, cyan halo; a ring once selected.
        display.size = attributes.size * (isSelected ? SELECTED_SIZE_FACTOR : HOVER_SIZE_FACTOR)
        display.glow = 1
        display.accent = isSelected ? SELECTED_ACCENT : HOVER_ACCENT
        display.highlighted = true
        display.forceLabel = true
        return display
      }
      if (highlight?.kind === 'path') {
        // Waypoints: lit like a hovered node and always labelled, so the route reads.
        display.size = attributes.size * PATH_NODE_SIZE_FACTOR
        display.glow = 1
        display.accent = HOVER_ACCENT
        display.forceLabel = true
        return display
      }
      if (dimsOthers) {
        display.size = attributes.size * NEIGHBOR_SIZE_FACTOR
        display.glow = Math.min(1, glow + NEIGHBOR_GLOW_BOOST)
        return display
      }
      display.glow = glow
      return display
    },

    edgeReducer(edgeId, attributes) {
      const display: EdgeDisplay = attributes
      const view = getView()
      // Filtered out, an end not drawn, or folded inside one aggregate (see anchoring).
      if (!isEdgeDrawn(graph, view, edgeId)) {
        display.hidden = true
        return display
      }
      const source = graph.source(edgeId)
      const target = graph.target(edgeId)
      const focus = getFocus()
      const { activeNodeId, isHover } = focus
      const { highlight } = view
      const sourceAggregate = aggregateOf(view, source)
      const targetAggregate = aggregateOf(view, target)
      if (sourceAggregate || targetAggregate) {
        const lit = focusCommunities(view, focus).aggregateCommunity ?? view.selectedCommunityId
        const touchesLit =
          lit !== null && (sourceAggregate?.communityId === lit || targetAggregate?.communityId === lit)
        const touchesActiveNode = source === activeNodeId || target === activeNodeId
        if (touchesLit || touchesActiveNode) {
          display.color = CANVAS_THEME.edgeFocus
          display.size = FOCUS_EDGE_SIZE
        } else {
          display.color = highlight || activeNodeId !== null ? CANVAS_THEME.edgeDimmed : CANVAS_THEME.edge
        }
        return display
      }
      if (highlight) {
        const touchesHover = isHover && (source === activeNodeId || target === activeNodeId)
        if (highlight.edgeIds ? highlight.edgeIds.has(edgeId) : touchesHover) {
          display.color = CANVAS_THEME.edgeFocus
          display.size = FOCUS_EDGE_SIZE
          display.flow = 1
        } else if (!highlight.edgeIds && highlight.nodeIds.has(source) && highlight.nodeIds.has(target)) {
          // Inside an expansion relations keep their resting look, a step brighter.
          display.color = restingEdgeColor(graph, source, target, graph.getNodeAttribute(source, 'community'))
        } else {
          display.color = CANVAS_THEME.edgeDimmed
        }
        return display
      }
      if (activeNodeId === null) {
        display.color = restingEdgeColor(graph, source, target, view.activeCommunity)
      } else if (source === activeNodeId || target === activeNodeId) {
        display.color = CANVAS_THEME.edgeFocus
        display.size = FOCUS_EDGE_SIZE
        display.flow = 1
      } else {
        display.color = CANVAS_THEME.edgeDimmed
      }
      return display
    },
  }
}
