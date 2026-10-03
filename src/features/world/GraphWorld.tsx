import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { computeAggregates, type GraphIndex, type KnowledgeGraph } from '@/graph'
import { createSigmaRenderer, type GraphRenderer, type Highlight } from '@/renderer'
import { ensurePositions } from '@/state/graph-session'
import { useExpansion, usePathView, useScope, useVisibility } from '@/state/selectors'
import { useAppStore } from '@/state/store'
import type { GraphModel, PositionMap } from '@/types/graph'
import { formatCount } from '@/ui/primitives'

interface GraphWorldProps {
  readonly model: GraphModel
  readonly index: GraphIndex
  readonly graph: KnowledgeGraph
  readonly positions: PositionMap
  /** Filled with the live renderer so the HUD can send camera commands. */
  readonly rendererRef: RefObject<GraphRenderer | null>
}

// Must match layout.css: below this width panels overlay the graph instead of flanking it.
const FLANKING_PANELS_QUERY = '(min-width: 1101px)'
// Panel width plus its gutters.
const PANEL_SIDE_INSET = 320

/** Space the open panels take on each side; read when the camera frames a scope. */
function panelSideInset(): number {
  const { panels } = useAppStore.getState()
  const hasFlankingPanel = panels.explorer || panels.inspector
  return hasFlankingPanel && window.matchMedia(FLANKING_PANELS_QUERY).matches ? PANEL_SIDE_INSET : 0
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The world: owns the Sigma renderer. React only pushes coarse state into it
 * (selection, visibility); hover, camera and every frame stay in the renderer.
 */
export function GraphWorld({ model, index, graph, positions, rendererRef }: GraphWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const relations = useAppStore((state) => state.filters.relations)
  const scope = useScope()
  const focusRequest = useAppStore((state) => state.focusRequest)
  const clearFocusRequest = useAppStore((state) => state.clearFocusRequest)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const showEdges = useAppStore((state) => state.preferences.showEdges)
  const selectNode = useAppStore((state) => state.selectNode)
  const selectedCommunityId = useAppStore((state) => state.selectedCommunityId)
  const selectCommunity = useAppStore((state) => state.selectCommunity)
  const aggregation = useAppStore((state) => state.aggregation)
  const setView = useAppStore((state) => state.setView)
  const setCamera = useAppStore((state) => state.setCamera)
  const cameraRequest = useAppStore((state) => state.cameraRequest)
  const clearCameraRequest = useAppStore((state) => state.clearCameraRequest)
  const recordMetrics = useAppStore((state) => state.recordMetrics)

  // Same derived mask the HUD counts from: one rule, one result.
  const wantedNodeIds = useVisibility(model).nodeIds
  // Only nodes that already have a position are drawn; the rest appear when
  // their layout finishes.
  const visibleNodeIds = useMemo(
    () => new Set([...wantedNodeIds].filter((id) => positions.has(id))),
    [wantedNodeIds, positions],
  )

  // Expansion and path are derived from the store ids and the current view;
  // the renderer only receives the resulting set to keep lit.
  const expansion = useExpansion(model, graph)
  const pathView = usePathView(model, graph, index)
  const modeHighlight = useMemo<Highlight | null>(() => {
    if (pathView.status === 'found') {
      return { kind: 'path', nodeIds: new Set(pathView.path.nodeIds), edgeIds: pathView.path.edgeIds }
    }
    return expansion ? { kind: 'expansion', nodeIds: expansion.nodeIds, edgeIds: null } : null
  }, [expansion, pathView])

  // Collapsed communities, drawn as one aggregate each. Derived from positions
  // that already exist; a shown path or expansion keeps its communities open.
  const aggregates = useMemo(
    () =>
      computeAggregates(graph, model, index, aggregation, visibleNodeIds, {
        keepExpandedFor: modeHighlight?.nodeIds,
      }),
    // `positions` is a dependency on purpose: the centres follow the layout.
    [graph, model, index, aggregation, visibleNodeIds, modeHighlight, positions],
  )
  // Clicks land on the representative node: this tells which community it stands for.
  const communityByRepresentative = useRef(new Map<string, number>())
  useEffect(() => {
    communityByRepresentative.current = new Map(
      [...aggregates.values()].map((aggregate) => [aggregate.representativeId, aggregate.communityId]),
    )
  }, [aggregates])

  // A selected community that is drawn as nodes is lit like an expansion.
  const highlight = useMemo<Highlight | null>(() => {
    if (modeHighlight) return modeHighlight
    if (selectedCommunityId === null || aggregates.has(selectedCommunityId)) return null
    const members = (index.nodeIdsByCommunity.get(selectedCommunityId) ?? []).filter((id) =>
      visibleNodeIds.has(id),
    )
    return members.length > 0 ? { kind: 'community', nodeIds: new Set(members), edgeIds: null } : null
  }, [modeHighlight, selectedCommunityId, aggregates, index, visibleNodeIds])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const createdAt = performance.now()
    const renderer = createSigmaRenderer(
      container,
      graph,
      {
        onNodeClick: (nodeId) => {
          const communityId = communityByRepresentative.current.get(nodeId)
          if (communityId === undefined) selectNode(nodeId)
          else selectCommunity(communityId)
        },
        onStageClick: () => {
          selectNode(null)
          selectCommunity(null)
        },
        onViewChange: setView,
        onCameraChange: setCamera,
        onFirstRender: () => recordMetrics({ firstRenderMs: performance.now() - createdAt }),
      },
      {
        cameraDuration: prefersReducedMotion() ? 0 : undefined,
        getSideInset: panelSideInset,
        reducedMotion: prefersReducedMotion(),
      },
    )
    rendererRef.current = renderer
    if (import.meta.env.DEV) {
      // Handle for browser tests and debugging; not part of the production build.
      Object.assign(window, { __EOG__: { renderer, store: useAppStore } })
    }
    return () => {
      rendererRef.current = null
      renderer.destroy()
    }
  }, [graph, rendererRef, selectNode, selectCommunity, setView, setCamera, recordMetrics])

  useEffect(() => {
    rendererRef.current?.setViewState({
      selectedNodeId,
      visibleNodeIds,
      showEdges,
      visibleRelations: relations ? new Set(relations) : null,
      activeCommunity: scope.community,
      highlight,
      aggregates,
      selectedCommunityId,
    })
  }, [
    graph,
    rendererRef,
    selectedNodeId,
    visibleNodeIds,
    showEdges,
    relations,
    scope.community,
    highlight,
    aggregates,
    selectedCommunityId,
  ])

  // A new scope is a new picture: frame it from the start.
  const framedScope = useRef(scope)
  useEffect(() => {
    if (framedScope.current === scope) return
    framedScope.current = scope
    rendererRef.current?.resetCamera()
  }, [rendererRef, scope])

  // Declared after the two effects above so the camera travels to the node
  // once it is drawn (it may still be waiting for its layout).
  useEffect(() => {
    if (focusRequest === null || !visibleNodeIds.has(focusRequest)) return
    // While a path or an expansion is shown the whole set stays framed (below).
    if (!highlight) rendererRef.current?.focusNode(focusRequest)
    clearFocusRequest()
  }, [rendererRef, focusRequest, visibleNodeIds, clearFocusRequest, highlight])

  // A restored view brings its own camera: it replaces the automatic framing.
  const hasCameraRequest = cameraRequest !== null

  // A new expansion, path or selected community is framed as a whole, with the same camera as focus.
  useEffect(() => {
    if (highlight && !hasCameraRequest) rendererRef.current?.frameNodes(highlight.nodeIds)
    // `hasCameraRequest` is read, not watched: clearing it must not re-frame.
  }, [rendererRef, highlight])

  // Declared last, so it has the final word over the framing effects above.
  // The camera is relative to what is drawn, so it waits for every node to have its position.
  useEffect(() => {
    if (cameraRequest === null || visibleNodeIds.size !== wantedNodeIds.size) return
    rendererRef.current?.setCamera(cameraRequest)
    clearCameraRequest()
  }, [rendererRef, cameraRequest, visibleNodeIds, wantedNodeIds, clearCameraRequest])

  useEffect(() => {
    void ensurePositions(wantedNodeIds)
  }, [wantedNodeIds, positions])

  return (
    <div
      ref={containerRef}
      className="eog-world"
      role="img"
      aria-label={`Knowledge graph: ${formatCount(visibleNodeIds.size)} of ${formatCount(model.metadata.nodeCount)} nodes visible`}
    />
  )
}
