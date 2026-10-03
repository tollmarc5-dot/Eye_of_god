import Sigma from 'sigma'
import type { EdgeAttributes, KnowledgeGraph, NodeAttributes } from '@/graph'
import type { CameraState, Position } from '@/types/graph'
import { CANVAS_THEME } from '@/styles/canvas-theme'
import { hexToUnitRgb } from '@/utils/color'
import { createLabelLayer, drawNodeHover } from './draw-labels'
import {
  createFrameMonitor,
  createMotionUniforms,
  initialQuality,
  isAnimated,
  resolveEffects,
  stepUniforms,
  type MotionQuality,
} from './motion'
import { createFlowEdgeProgram } from './programs/flow-edge'
import { createGlowNodeProgram } from './programs/glow-node'
import {
  computeFocus,
  createReducers,
  EMPTY_VIEW_STATE,
  isNodeHidden,
  NO_FOCUS,
  type FocusState,
  type RendererViewState,
} from './reducers'
import {
  CAMERA_RATIO_LIMITS,
  LABEL_THRESHOLD_BY_LEVEL,
  viewInfoForRatio,
  zoomLevelForRatio,
  type ViewInfo,
  type ZoomLevel,
} from './zoom-level'

export interface RendererEvents {
  onNodeClick?: (nodeId: string) => void
  onStageClick?: () => void
  onFirstRender?: () => void
  /** Zoom level / percentage, throttled: never called per frame. */
  onViewChange?: (view: ViewInfo) => void
  /** Camera position and zoom, on the same throttle as onViewChange. */
  onCameraChange?: (camera: CameraState) => void
}

export interface RendererOptions {
  /** Camera transition length in ms; 0 for users who prefer reduced motion. */
  readonly cameraDuration?: number
  /** Width in CSS pixels that HUD panels cover on each side, asked when framing. */
  readonly getSideInset?: () => number
  /** True for users who prefer reduced motion: no continuous animation at all. */
  readonly reducedMotion?: boolean
}

/** The app talks to this interface only, never to Sigma directly. */
export interface GraphRenderer {
  setViewState(state: RendererViewState): void
  /** Centres the camera on a node. Returns false when the node is not drawn. */
  focusNode(nodeId: string): boolean
  /**
   * Frames a node together with the neighbours that are drawn. Falls back to
   * focusNode when it has none. Returns false when the node is not drawn.
   */
  frameNeighborhood(nodeId: string): boolean
  /** Frames a set of nodes (an expansion, a path). Hidden ids are ignored. Returns false when none is drawn. */
  frameNodes(nodeIds: Iterable<string>): boolean
  zoomIn(): void
  zoomOut(): void
  resetCamera(): void
  getCamera(): CameraState
  /** Puts the camera somewhere at once (a restored view). Cancels any running transition. */
  setCamera(camera: Pick<CameraState, 'x' | 'y' | 'ratio'>): void
  /** Where a node currently is on screen (CSS pixels), or null if it is not drawn. */
  getNodeViewportPosition(nodeId: string): Position | null
  /** How much the renderer is animating right now ('still' = nothing runs per frame). */
  getMotionQuality(): MotionQuality
  destroy(): void
}

const DEFAULT_CAMERA_DURATION = 250
const FOCUS_RATIO = 0.2
// Travelling to a node is a longer move than a zoom step, so it gets more time.
const FOCUS_DURATION_FACTOR = 1.8
// Keeps the graph clear of the HUD at the edges of the viewport.
// Free space kept around a framed neighbourhood: top bar above, dock below.
const FRAME_MARGIN_X = 48
const FRAME_MARGIN_Y = 120
// Never zoom in further than this on a tight set of nodes: no extreme close-ups.
const MIN_FRAME_RATIO = 0.12
const STAGE_PADDING = 72
const VIEW_CHANGE_THROTTLE_MS = 120
// Fewer, better spaced candidates; the label layer then removes every overlap.
const LABEL_DENSITY = 0.6
const LABEL_GRID_CELL_SIZE = 180
// Level of detail: above this many drawn edges they are skipped while the
// camera moves, which keeps panning smooth on the full graph.
const HIDE_EDGES_ON_MOVE_ABOVE = 4000

export interface BoundingBox {
  x: [number, number]
  y: [number, number]
}

/** Extent of the visible nodes, so hidden ones do not shrink the view. */
function visibleBoundingBox(graph: KnowledgeGraph, view: RendererViewState): BoundingBox | null {
  if (view.visibleNodeIds === null || view.visibleNodeIds.size === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const nodeId of view.visibleNodeIds) {
    if (!graph.hasNode(nodeId)) continue
    const { x, y } = graph.getNodeAttributes(nodeId)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return Number.isFinite(minX) ? { x: [minX, maxX], y: [minY, maxY] } : null
}

/**
 * Camera ratio at which a graph of the given extent stays clear of `sideInset`
 * pixels on both sides. 1 (Sigma's own fit) whenever it already does.
 */
export function framingRatio(
  box: BoundingBox | null,
  width: number,
  height: number,
  sideInset: number,
): number {
  const freeWidth = width - 2 * sideInset
  const fitWidth = width - 2 * STAGE_PADDING
  const fitHeight = height - 2 * STAGE_PADDING
  if (!box || !(sideInset > 0) || !(freeWidth > 0) || !(fitWidth > 0) || !(fitHeight > 0)) return 1
  const boxHeight = box.y[1] - box.y[0]
  const aspect = boxHeight > 0 ? (box.x[1] - box.x[0]) / boxHeight : Infinity
  const drawnWidth = Math.min(fitWidth, fitHeight * aspect)
  return Math.max(1, drawnWidth / freeWidth)
}

function countVisibleEdges(graph: KnowledgeGraph, view: RendererViewState): number {
  if (!view.showEdges) return 0
  if (view.visibleNodeIds === null) return graph.size
  let count = 0
  graph.forEachEdge((_edge, _attributes, source, target) => {
    if (!isNodeHidden(view, source) && !isNodeHidden(view, target)) count += 1
  })
  return count
}

/**
 * WebGL renderer (Sigma). Styling is decided by reducers from the view state,
 * so filters and selection never mutate the graph. Hover is resolved here and
 * never reaches React.
 */
export function createSigmaRenderer(
  container: HTMLElement,
  graph: KnowledgeGraph,
  events: RendererEvents = {},
  options: RendererOptions = {},
): GraphRenderer {
  const duration = options.cameraDuration ?? DEFAULT_CAMERA_DURATION
  let view = EMPTY_VIEW_STATE
  let hoveredNodeId: string | null = null
  let focus: FocusState = NO_FOCUS
  let visibleBox: BoundingBox | null = null

  // Shared with the WebGL programs: the render loop writes, the shaders read.
  let level: ZoomLevel = 'universe'
  const monitor = createFrameMonitor(initialQuality(options.reducedMotion ?? false))
  const motion = createMotionUniforms(resolveEffects(level, monitor.quality))
  const accentColor = hexToUnitRgb(CANVAS_THEME.accent)

  const reducers = createReducers(
    graph,
    () => view,
    () => focus,
  )
  const labels = createLabelLayer()
  const sigma = new Sigma<NodeAttributes, EdgeAttributes>(graph, container, {
    defaultNodeType: 'glow',
    nodeProgramClasses: { glow: createGlowNodeProgram(motion, accentColor) },
    defaultEdgeType: 'flow',
    edgeProgramClasses: { flow: createFlowEdgeProgram(motion, accentColor) },
    stagePadding: STAGE_PADDING,
    labelColor: { color: CANVAS_THEME.label },
    labelFont: CANVAS_THEME.labelFont,
    labelSize: CANVAS_THEME.labelSize,
    labelWeight: CANVAS_THEME.labelWeight,
    labelRenderedSizeThreshold: LABEL_THRESHOLD_BY_LEVEL.universe,
    labelDensity: LABEL_DENSITY,
    labelGridCellSize: LABEL_GRID_CELL_SIZE,
    defaultDrawNodeLabel: labels.collect,
    defaultDrawNodeHover: drawNodeHover,
    nodeReducer: reducers.nodeReducer,
    edgeReducer: reducers.edgeReducer,
    // Every camera, wheel and button included, stays where the graph can still be read.
    minCameraRatio: CAMERA_RATIO_LIMITS.min,
    maxCameraRatio: CAMERA_RATIO_LIMITS.max,
  })
  const camera = sigma.getCamera()

  const setHovered = (nodeId: string | null): void => {
    hoveredNodeId = nodeId
    focus = computeFocus(graph, view, hoveredNodeId)
    container.style.cursor = nodeId === null ? '' : 'pointer'
    sigma.refresh({ skipIndexation: true })
  }

  sigma.on('clickNode', ({ node }) => events.onNodeClick?.(node))
  sigma.on('clickStage', () => events.onStageClick?.())
  sigma.on('enterNode', ({ node }) => setHovered(node))
  sigma.on('leaveNode', () => setHovered(null))

  // Sigma offers the frame's labels one by one between these two events; they
  // are placed and drawn together once it is done.
  let hasRendered = false
  sigma.on('beforeRender', labels.reset)
  sigma.on('afterRender', () => {
    labels.draw()
    if (hasRendered) return
    hasRendered = true
    events.onFirstRender?.()
  })

  // Sigma emits leaveNode when the pointer leaves the canvas but keeps its own
  // hovered node, so the hover label would stay painted. Drop it here.
  const clearStaleHover = (): void => {
    const internals = sigma as unknown as { hoveredNode: string | null }
    if (internals.hoveredNode === null) return
    internals.hoveredNode = null
    setHovered(null)
  }
  container.addEventListener('mouseleave', clearStaleHover)

  // The living graph: one cheap redraw per frame. Positions drift inside the
  // shaders, so nothing is recomputed, re-indexed or sent to React here.
  let frame: number | null = null
  let startedAt: number | null = null
  let previousAt = 0
  const tick = (now: number): void => {
    startedAt ??= now
    const quality = monitor.sample(now - previousAt)
    previousAt = now
    stepUniforms(motion, resolveEffects(level, quality), (now - startedAt) / 1000)
    sigma.scheduleRender()
    // 'still' is reached once frames stay slow; let the drift ease to zero, then stop.
    frame = isAnimated(quality) || motion.amplitude > 0 ? requestAnimationFrame(tick) : null
  }
  if (isAnimated(monitor.quality) && typeof requestAnimationFrame === 'function') {
    frame = requestAnimationFrame((now) => {
      previousAt = now
      tick(now)
    })
  }
  // Level of detail follows the camera: more labels as the user gets closer.
  let viewTimer: ReturnType<typeof setTimeout> | null = null
  camera.on('updated', ({ ratio }) => {
    const nextLevel = zoomLevelForRatio(ratio)
    if (nextLevel !== level) {
      level = nextLevel
      sigma.setSetting('labelRenderedSizeThreshold', LABEL_THRESHOLD_BY_LEVEL[level])
      // Without the loop nothing eases the effects: follow the level directly.
      if (frame === null) Object.assign(motion, resolveEffects(level, monitor.quality))
    }
    if ((!events.onViewChange && !events.onCameraChange) || viewTimer !== null) return
    viewTimer = setTimeout(() => {
      viewTimer = null
      const { x, y, ratio, angle } = camera.getState()
      events.onViewChange?.(viewInfoForRatio(ratio))
      events.onCameraChange?.({ x, y, ratio, angle })
    }, VIEW_CHANGE_THROTTLE_MS)
  })

  return {
    setViewState(state) {
      const visibilityChanged =
        state.visibleNodeIds !== view.visibleNodeIds || state.showEdges !== view.showEdges
      // Collapsing or expanding moves nodes on screen: Sigma has to re-index them.
      const aggregatesChanged = state.aggregates !== view.aggregates
      view = state
      focus = computeFocus(graph, view, hoveredNodeId)
      if (!visibilityChanged) {
        sigma.refresh({ skipIndexation: !aggregatesChanged })
        return
      }
      visibleBox = visibleBoundingBox(graph, view)
      sigma.setCustomBBox(visibleBox)
      sigma.setSetting('hideEdgesOnMove', countVisibleEdges(graph, view) > HIDE_EDGES_ON_MOVE_ABOVE)
      sigma.refresh()
    },
    focusNode(nodeId) {
      if (isNodeHidden(view, nodeId)) return false
      const display = sigma.getNodeDisplayData(nodeId)
      if (!display) return false
      void camera.animate(
        { x: display.x, y: display.y, ratio: FOCUS_RATIO },
        { duration: duration * FOCUS_DURATION_FACTOR, easing: 'cubicInOut' },
      )
      return true
    },
    frameNeighborhood(nodeId) {
      if (!graph.hasNode(nodeId) || isNodeHidden(view, nodeId)) return false
      return this.frameNodes([nodeId, ...graph.neighbors(nodeId)])
    },
    frameNodes(nodeIds) {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let firstId: string | null = null
      for (const id of nodeIds) {
        if (!graph.hasNode(id) || isNodeHidden(view, id)) continue
        const display = sigma.getNodeDisplayData(id)
        if (!display) continue
        firstId ??= id
        if (display.x < minX) minX = display.x
        if (display.x > maxX) maxX = display.x
        if (display.y < minY) minY = display.y
        if (display.y > maxY) maxY = display.y
      }
      if (firstId === null) return false
      // How large the set is on screen now tells how far to zoom.
      const from = sigma.framedGraphToViewport({ x: minX, y: minY })
      const to = sigma.framedGraphToViewport({ x: maxX, y: maxY })
      const freeWidth =
        container.clientWidth - 2 * (options.getSideInset?.() ?? 0) - 2 * FRAME_MARGIN_X
      const freeHeight = container.clientHeight - 2 * FRAME_MARGIN_Y
      const scale = Math.max(Math.abs(to.x - from.x) / freeWidth, Math.abs(to.y - from.y) / freeHeight)
      if (!(scale > 0) || !Number.isFinite(scale)) return this.focusNode(firstId)
      void camera.animate(
        {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          ratio: Math.max(MIN_FRAME_RATIO, camera.getState().ratio * scale),
        },
        { duration: duration * FOCUS_DURATION_FACTOR, easing: 'cubicInOut' },
      )
      return true
    },
    zoomIn() {
      void camera.animatedZoom({ duration })
    },
    zoomOut() {
      void camera.animatedUnzoom({ duration })
    },
    resetCamera() {
      const ratio = framingRatio(
        visibleBox,
        container.clientWidth,
        container.clientHeight,
        options.getSideInset?.() ?? 0,
      )
      if (ratio === 1) void camera.animatedReset({ duration })
      else void camera.animate({ x: 0.5, y: 0.5, angle: 0, ratio }, { duration })
    },
    getCamera() {
      const { x, y, ratio, angle } = camera.getState()
      return { x, y, ratio, angle }
    },
    setCamera({ x, y, ratio }) {
      // animate() with no duration is the one call that also cancels a transition in flight.
      void camera.animate({ x, y, ratio, angle: 0 }, { duration: 0 })
    },
    getNodeViewportPosition(nodeId) {
      if (!graph.hasNode(nodeId) || isNodeHidden(view, nodeId)) return null
      const { x, y } = graph.getNodeAttributes(nodeId)
      return sigma.graphToViewport({ x, y })
    },
    getMotionQuality() {
      return monitor.quality
    },
    destroy() {
      if (frame !== null) cancelAnimationFrame(frame)
      if (viewTimer !== null) clearTimeout(viewTimer)
      container.removeEventListener('mouseleave', clearStaleHover)
      // A camera transition still running would keep asking the dead instance to
      // render: a disabled camera ignores it.
      camera.disable()
      container.style.cursor = ''
      sigma.kill()
    },
  }
}
