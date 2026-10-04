import Sigma from 'sigma'
import type { EdgeAttributes, KnowledgeGraph, NodeAttributes } from '@/graph'
import type { CameraState, Position } from '@/types/graph'
import { CANVAS_THEME } from '@/styles/canvas-theme'
import { hexToUnitRgb } from '@/utils/color'
import { createLabelLayer, drawNodeHover } from './draw-labels'
import {
  freeCentre,
  freeInsets,
  isInFreeArea,
  isUnderRects,
  NO_INSETS,
  sameRects,
  type FreeInsets,
  type ScreenRect,
} from './free-area'
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
  /** True for users who prefer reduced motion: no continuous animation at all. */
  readonly reducedMotion?: boolean
}

/** The app talks to this interface only, never to Sigma directly. */
export interface GraphRenderer {
  setViewState(state: RendererViewState): void
  /**
   * Rectangles of the viewport the HUD covers, in CSS pixels of the graph's
   * container. Labels stay out of them and every framing centres the camera in
   * what is left; a selected node they would hide is brought back into view.
   */
  setOccludedRects(rects: readonly ScreenRect[]): void
  /**
   * Where to read what the HUD covers at the very moment a framing starts, so
   * a panel that changed in the same update (the inspector filling up on a
   * selection) is already taken into account. Reads it once right away.
   */
  setOcclusionSource(read: () => readonly ScreenRect[]): void
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
// Free space kept around a framed set of nodes. Without HUD rectangles the
// vertical margin also stands in for the top bar and the dock.
const FRAME_MARGIN_X = 48
const FRAME_MARGIN_Y = 120
// With the HUD known, the free area already excludes it: a small margin is enough.
const FRAME_MARGIN_IN_FREE_AREA = 32
// A selected node closer than this to the edge of the free area counts as hidden.
const SELECTED_NODE_MARGIN = 24
/** Room kept between the end of the selected node's plate and the HUD. */
const PLATE_END_MARGIN = 8
// While the camera travels, the check for the selected node waits and retries.
const VISIBILITY_RETRY_MS = 120
const VISIBILITY_MAX_RETRIES = 25
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
 * Camera ratio at which a graph of the given extent fits the free area the
 * HUD leaves (`insets`). 1 (Sigma's own fit) whenever it already does.
 */
export function framingRatio(
  box: BoundingBox | null,
  width: number,
  height: number,
  insets: FreeInsets,
): number {
  const freeWidth = width - insets.left - insets.right
  const freeHeight = height - insets.top - insets.bottom
  const fitWidth = width - 2 * STAGE_PADDING
  const fitHeight = height - 2 * STAGE_PADDING
  if (!box || !(freeWidth > 0) || !(freeHeight > 0) || !(fitWidth > 0) || !(fitHeight > 0)) return 1
  const boxWidth = box.x[1] - box.x[0]
  const boxHeight = box.y[1] - box.y[0]
  const aspect = boxHeight > 0 ? boxWidth / boxHeight : Infinity
  // Size of the graph on screen at ratio 1, as Sigma fits it into the padded viewport.
  const drawnWidth = Math.min(fitWidth, fitHeight * aspect)
  const drawnHeight = aspect > 0 ? Math.min(fitHeight, fitWidth / aspect) : fitHeight
  return Math.max(1, drawnWidth / freeWidth, drawnHeight / freeHeight)
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
  let occluded: readonly ScreenRect[] = []
  let visibilityTimer: ReturnType<typeof setTimeout> | null = null
  let readOccluded: (() => readonly ScreenRect[]) | null = null
  // A camera restored from a link stays exactly where it was shared until the
  // user acts: the HUD settling while the page loads must not move it.
  let isCameraHeld = false

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
    labels.draw({ reserved: occluded, width: container.clientWidth, height: container.clientHeight })
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
  const releaseCamera = (): void => {
    isCameraHeld = false
  }
  container.addEventListener('pointerdown', releaseCamera)
  container.addEventListener('wheel', releaseCamera, { passive: true })

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

  const currentInsets = (): FreeInsets =>
    occluded.length === 0 ? NO_INSETS : freeInsets(container.clientWidth, container.clientHeight, occluded)

  /**
   * The camera that puts `target` (framed-graph coordinates, at `target.ratio`)
   * in the centre of the free area instead of the centre of the viewport.
   * Viewport and framed graph are related by a translation at a given ratio,
   * so if Q is what lands on the free centre with the camera on P, the camera
   * on 2P - Q lands P there.
   */
  const inFreeCentre = (target: { x: number; y: number; ratio: number }): { x: number; y: number; ratio: number } => {
    // Nothing covers the graph: the free centre is the centre of the viewport.
    if (occluded.length === 0) return target
    const width = container.clientWidth
    const height = container.clientHeight
    const centre = freeCentre(width, height, currentInsets())
    if (Math.abs(centre.x - width / 2) < 1 && Math.abs(centre.y - height / 2) < 1) return target
    const landing = sigma.viewportToFramedGraph(centre, {
      cameraState: { x: target.x, y: target.y, ratio: target.ratio, angle: 0 },
    })
    return { x: 2 * target.x - landing.x, y: 2 * target.y - landing.y, ratio: target.ratio }
  }

  /** Brings the selected node back into the free area when the HUD has just covered it. */
  const keepSelectedVisible = (attempt = 0): void => {
    visibilityTimer = null
    const nodeId = view.selectedNodeId
    if (isCameraHeld || nodeId === null || !graph.hasNode(nodeId) || isNodeHidden(view, nodeId)) return
    // A camera already on its way somewhere decides first; look again once it lands.
    if (camera.isAnimated()) {
      if (attempt < VISIBILITY_MAX_RETRIES) {
        visibilityTimer = setTimeout(() => keepSelectedVisible(attempt + 1), VISIBILITY_RETRY_MS)
      }
      return
    }
    const display = sigma.getNodeDisplayData(nodeId)
    if (!display) return
    const onScreen = sigma.framedGraphToViewport(display)
    const insets = currentInsets()
    const isClear = (point: { x: number; y: number }, margin: number): boolean =>
      isInFreeArea(point, container.clientWidth, container.clientHeight, insets, margin) &&
      !isUnderRects(point, occluded, margin)
    // The node and the end of its plate: a name cut by a panel is not visible either.
    const reach = labels.plateReach({ size: sigma.scaleSize(display.size), label: display.label })
    const plateEnd = { x: onScreen.x + reach, y: onScreen.y }
    if (isClear(onScreen, SELECTED_NODE_MARGIN) && (reach === 0 || isClear(plateEnd, PLATE_END_MARGIN))) return
    // Centre the node and its plate together.
    const anchor =
      reach === 0
        ? display
        : sigma.viewportToFramedGraph({ x: onScreen.x + reach / 2, y: onScreen.y })
    void camera.animate(inFreeCentre({ x: anchor.x, y: anchor.y, ratio: camera.getState().ratio }), {
      duration,
      easing: 'cubicInOut',
    })
  }

  const applyOccluded = (rects: readonly ScreenRect[]): boolean => {
    if (sameRects(rects, occluded)) return false
    occluded = rects
    sigma.scheduleRender()
    return true
  }

  /** Every framing starts here: the user asked for a move, and the HUD is read as it is now. */
  const beforeFraming = (): void => {
    releaseCamera()
    if (readOccluded) applyOccluded(readOccluded())
  }

  return {
    setOccludedRects(rects) {
      if (!applyOccluded(rects)) return
      if (visibilityTimer !== null) clearTimeout(visibilityTimer)
      keepSelectedVisible()
    },
    setOcclusionSource(read) {
      readOccluded = read
      applyOccluded(read())
    },
    setViewState(state) {
      const visibilityChanged =
        state.visibleNodeIds !== view.visibleNodeIds || state.showEdges !== view.showEdges
      // Collapsing or expanding moves nodes on screen: Sigma has to re-index them.
      const aggregatesChanged = state.aggregates !== view.aggregates
      if (state.selectedNodeId !== view.selectedNodeId) releaseCamera()
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
      beforeFraming()
      void camera.animate(inFreeCentre({ x: display.x, y: display.y, ratio: FOCUS_RATIO }), {
        duration: duration * FOCUS_DURATION_FACTOR,
        easing: 'cubicInOut',
      })
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
      beforeFraming()
      // How large the set is on screen now tells how far to zoom.
      const from = sigma.framedGraphToViewport({ x: minX, y: minY })
      const to = sigma.framedGraphToViewport({ x: maxX, y: maxY })
      const insets = currentInsets()
      const marginX = occluded.length > 0 ? FRAME_MARGIN_IN_FREE_AREA : FRAME_MARGIN_X
      const marginY = occluded.length > 0 ? FRAME_MARGIN_IN_FREE_AREA : FRAME_MARGIN_Y
      const freeWidth = container.clientWidth - insets.left - insets.right - 2 * marginX
      const freeHeight = container.clientHeight - insets.top - insets.bottom - 2 * marginY
      const scale = Math.max(Math.abs(to.x - from.x) / freeWidth, Math.abs(to.y - from.y) / freeHeight)
      if (!(scale > 0) || !Number.isFinite(scale)) return this.focusNode(firstId)
      const target = inFreeCentre({
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        ratio: Math.max(MIN_FRAME_RATIO, camera.getState().ratio * scale),
      })
      void camera.animate(target, { duration: duration * FOCUS_DURATION_FACTOR, easing: 'cubicInOut' })
      return true
    },
    zoomIn() {
      releaseCamera()
      void camera.animatedZoom({ duration })
    },
    zoomOut() {
      releaseCamera()
      void camera.animatedUnzoom({ duration })
    },
    resetCamera() {
      beforeFraming()
      const ratio = framingRatio(visibleBox, container.clientWidth, container.clientHeight, currentInsets())
      const target = inFreeCentre({ x: 0.5, y: 0.5, ratio })
      if (target.ratio === 1 && target.x === 0.5 && target.y === 0.5) void camera.animatedReset({ duration })
      else void camera.animate({ ...target, angle: 0 }, { duration })
    },
    getCamera() {
      const { x, y, ratio, angle } = camera.getState()
      return { x, y, ratio, angle }
    },
    setCamera({ x, y, ratio }) {
      isCameraHeld = true
      if (visibilityTimer !== null) clearTimeout(visibilityTimer)
      visibilityTimer = null
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
      if (visibilityTimer !== null) clearTimeout(visibilityTimer)
      container.removeEventListener('mouseleave', clearStaleHover)
      container.removeEventListener('pointerdown', releaseCamera)
      container.removeEventListener('wheel', releaseCamera)
      // A camera transition still running would keep asking the dead instance to
      // render: a disabled camera ignores it.
      camera.disable()
      container.style.cursor = ''
      sigma.kill()
    },
  }
}
