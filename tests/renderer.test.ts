import { beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { applyPositions, buildGraph, buildGraphIndex } from '@/graph'
import { createSigmaRenderer, framingRatio, LABEL_THRESHOLD_BY_LEVEL, zoomLevelForRatio } from '@/renderer'
import { stagePaddingFor } from '@/renderer/sigma-renderer'
import { EMPTY_VIEW_STATE } from '@/renderer/reducers'
import { CAMERA_RATIO_LIMITS } from '@/renderer/zoom-level'
import { decodeViewState } from '@/state/url-state'
import { makeRawGraph } from './fixtures'

const contextModel = adaptGraphify(makeRawGraph())
const context = { model: contextModel, index: buildGraphIndex(contextModel) }

type Handler = (payload: { node: string }) => void

// Sigma needs WebGL, which does not exist in Node: this fake records how the
// renderer drives it. Real rendering is covered by the browser check.
const fake = vi.hoisted(() => {
  class FakeSigma {
    static instances: FakeSigma[] = []
    handlers = new Map<string, Handler>()
    cameraHandlers = new Map<string, (state: { ratio: number }) => void>()
    camera = {
      on: (event: string, handler: (state: { ratio: number }) => void) => {
        this.cameraHandlers.set(event, handler)
      },
      animate: vi.fn(() => Promise.resolve()),
      animatedZoom: vi.fn(() => Promise.resolve()),
      animatedUnzoom: vi.fn(() => Promise.resolve()),
      animatedReset: vi.fn(() => Promise.resolve()),
      getState: vi.fn(() => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 })),
      isAnimated: vi.fn(() => false),
      disable: vi.fn(),
    }
    hoveredNode: string | null = null
    refresh = vi.fn()
    scheduleRender = vi.fn()
    kill = vi.fn()
    setSetting = vi.fn()
    setCustomBBox = vi.fn()
    getNodeDisplayData = vi.fn((id: string) => (id === 'missing' ? undefined : { x: 0.3, y: 0.7 }))
    graphToViewport = vi.fn(() => ({ x: 120, y: 80 }))
    framedGraphToViewport = vi.fn(({ x, y }: { x: number; y: number }) => ({ x: x * 1000, y: y * 1000 }))
    scaleSize = vi.fn((size = 1) => size)
    // A 1000 × 800 viewport where 1000 px are one framed-graph unit at ratio 1.
    viewportToFramedGraph = vi.fn(
      (point: { x: number; y: number }, override: { cameraState?: { x: number; y: number; ratio: number } } = {}) => {
        const camera = override.cameraState ?? { x: 0.5, y: 0.5, ratio: 1 }
        return {
          x: camera.x + ((point.x - 500) / 1000) * camera.ratio,
          y: camera.y + ((point.y - 400) / 1000) * camera.ratio,
        }
      },
    )

    constructor(
      public graph: unknown,
      public container: unknown,
      public settings: Record<string, unknown>,
    ) {
      FakeSigma.instances.push(this)
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler)
    }
    once(event: string, handler: Handler) {
      this.handlers.set(event, handler)
    }
    getCamera() {
      return this.camera
    }
    emit(event: string, node = '') {
      this.handlers.get(event)?.({ node })
    }
  }
  return { FakeSigma }
})

vi.mock('sigma', () => ({ default: fake.FakeSigma }))
// The program base classes touch WebGL as soon as they are imported.
vi.mock('sigma/rendering', () => ({ NodeProgram: class {}, EdgeProgram: class {} }))
vi.mock('sigma/utils', () => ({ floatColor: () => 0 }))

function setup(events: Parameters<typeof createSigmaRenderer>[2] = {}, cameraDuration = 0) {
  const model = adaptGraphify(makeRawGraph())
  const graph = buildGraph(model)
  applyPositions(graph, new Map(model.nodes.map((node, i) => [node.id, { x: i * 10, y: i * 5 }])))
  const listeners = new Map<string, () => void>()
  const container = {
    style: { cursor: '' },
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLElement
  // The loop tests need the living graph; the app itself starts still (see the test below).
  const renderer = createSigmaRenderer(container, graph, events, { cameraDuration, living: true })
  const sigma = fake.FakeSigma.instances.at(-1)
  if (!sigma) throw new Error('Sigma was not instantiated')
  return { renderer, sigma, graph, container, listeners }
}

beforeEach(() => {
  fake.FakeSigma.instances.length = 0
})

describe('createSigmaRenderer', () => {
  test('creates one Sigma instance on the container with both reducers', () => {
    const { sigma, graph, container } = setup()

    expect(fake.FakeSigma.instances).toHaveLength(1)
    expect(sigma.graph).toBe(graph)
    expect(sigma.container).toBe(container)
    expect(sigma.settings.nodeReducer).toBeTypeOf('function')
    expect(sigma.settings.edgeReducer).toBeTypeOf('function')
  })

  test('destroy kills the Sigma instance and silences a camera transition in flight', () => {
    const { renderer, sigma } = setup()

    renderer.destroy()

    expect(sigma.kill).toHaveBeenCalledOnce()
    expect(sigma.camera.disable).toHaveBeenCalledOnce()
  })

  test('reports node clicks, stage clicks and the first render', () => {
    const onNodeClick = vi.fn()
    const onStageClick = vi.fn()
    const onFirstRender = vi.fn()
    const { sigma } = setup({ onNodeClick, onStageClick, onFirstRender })

    sigma.emit('clickNode', 'os')
    sigma.emit('clickStage')
    sigma.emit('afterRender')

    expect(onNodeClick).toHaveBeenCalledWith('os')
    expect(onStageClick).toHaveBeenCalledOnce()
    expect(onFirstRender).toHaveBeenCalledOnce()
  })

  test('the first render is reported once, however many frames follow', () => {
    const onFirstRender = vi.fn()
    const { sigma } = setup({ onFirstRender })

    sigma.emit('afterRender')
    sigma.emit('afterRender')

    expect(onFirstRender).toHaveBeenCalledOnce()
  })

  test('the camera cannot zoom out of the readable range, by any control', () => {
    const { sigma } = setup()

    expect(sigma.settings.minCameraRatio).toBe(CAMERA_RATIO_LIMITS.min)
    expect(sigma.settings.maxCameraRatio).toBe(CAMERA_RATIO_LIMITS.max)
    // Every reachable camera is a camera a shared link can restore.
    expect(decodeViewState(`?cam=0.5,0.5,${CAMERA_RATIO_LIMITS.min}`, context).camera?.ratio).toBe(CAMERA_RATIO_LIMITS.min)
    expect(decodeViewState(`?cam=0.5,0.5,${CAMERA_RATIO_LIMITS.max}`, context).camera?.ratio).toBe(CAMERA_RATIO_LIMITS.max)
  })

  test("a frame's labels are collected while Sigma renders and drawn together when it is done", () => {
    const { sigma } = setup()
    const fillText = vi.fn()
    const labelContext = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      strokeText: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D
    const drawLabel = sigma.settings.defaultDrawNodeLabel as (
      context: CanvasRenderingContext2D,
      data: object,
      settings: object,
    ) => void
    const settings = { labelSize: 12, labelFont: 'sans-serif', labelWeight: '500' }

    sigma.emit('beforeRender')
    drawLabel(labelContext, { key: 'a', label: 'first', x: 100, y: 100, size: 10 }, settings)
    drawLabel(labelContext, { key: 'b', label: 'second', x: 112, y: 101, size: 4 }, settings)
    expect(fillText).not.toHaveBeenCalled()
    sigma.emit('afterRender')

    expect(fillText.mock.calls.map(([text]) => text)).toEqual(['first', 'second'])
    // 'second' would start on top of 'first': it is drawn on the other side of its node.
    expect(fillText.mock.calls[1]?.[1]).toBeLessThan(112)
  })

  test('selection only restyles: no re-indexing, no new bounding box', () => {
    const { renderer, sigma } = setup()

    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })

    expect(sigma.refresh).toHaveBeenCalledWith({ skipIndexation: true })
    expect(sigma.setCustomBBox).not.toHaveBeenCalled()
  })

  test('a visibility change frames the camera on the visible nodes only', () => {
    const { renderer, sigma } = setup()

    renderer.setViewState({ ...EMPTY_VIEW_STATE, visibleNodeIds: new Set(['app_index', 'app_index_main']) })

    expect(sigma.setCustomBBox).toHaveBeenCalledWith({ x: [0, 10], y: [0, 5] })
    expect(sigma.setSetting).toHaveBeenCalledWith('hideEdgesOnMove', false)
  })

  test('hover is resolved inside the renderer and sets the pointer cursor', () => {
    const { sigma, container } = setup()

    sigma.emit('enterNode', 'os')
    expect(container.style.cursor).toBe('pointer')
    expect(sigma.refresh).toHaveBeenLastCalledWith({ skipIndexation: true })

    sigma.emit('leaveNode')
    expect(container.style.cursor).toBe('')
  })
})

describe('hover clean-up', () => {
  test('leaving the canvas drops the hovered node Sigma would keep painting', () => {
    const { sigma, listeners, container } = setup()
    sigma.emit('enterNode', 'os')
    sigma.hoveredNode = 'os'

    listeners.get('mouseleave')?.()

    expect(sigma.hoveredNode).toBeNull()
    expect(container.style.cursor).toBe('')
  })

  test('destroy removes the listener it added', () => {
    const { renderer, listeners } = setup()

    renderer.destroy()

    expect(listeners.has('mouseleave')).toBe(false)
  })
})

describe('level of detail', () => {
  test('raises label density when the camera crosses a zoom level', () => {
    const { sigma } = setup()

    sigma.cameraHandlers.get('updated')?.({ ratio: 0.5 })
    sigma.cameraHandlers.get('updated')?.({ ratio: 0.45 })

    const labelCalls = sigma.setSetting.mock.calls.filter(([key]) => key === 'labelRenderedSizeThreshold')
    expect(labelCalls).toEqual([['labelRenderedSizeThreshold', LABEL_THRESHOLD_BY_LEVEL.structure]])
  })

  test('reports the view throttled, not once per camera update', () => {
    vi.useFakeTimers()
    const onViewChange = vi.fn()
    const { sigma } = setup({ onViewChange })
    sigma.camera.getState.mockReturnValue({ x: 0.5, y: 0.5, ratio: 0.2, angle: 0 })

    for (let i = 0; i < 10; i += 1) sigma.cameraHandlers.get('updated')?.({ ratio: 0.2 })
    vi.runAllTimers()
    vi.useRealTimers()

    expect(onViewChange).toHaveBeenCalledOnce()
    expect(onViewChange).toHaveBeenCalledWith({ level: 'detail', zoomPercent: 500 })
  })
})

describe('zoomLevelForRatio', () => {
  test.each([
    [1, 'universe'],
    [0.7, 'universe'],
    [0.5, 'structure'],
    [0.25, 'structure'],
    [0.2, 'detail'],
  ])('ratio %s is the %s level', (ratio, level) => {
    expect(zoomLevelForRatio(ratio)).toBe(level)
  })
})

describe('camera', () => {
  test('focusNode moves the camera onto the node', () => {
    const { renderer, sigma } = setup()

    const moved = renderer.focusNode('os')

    expect(moved).toBe(true)
    expect(sigma.camera.animate).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.3, y: 0.7 }),
      expect.objectContaining({ duration: 0 }),
    )
  })

  test('focusNode does nothing for hidden or unknown nodes', () => {
    const { renderer, sigma } = setup()
    renderer.setViewState({ ...EMPTY_VIEW_STATE, visibleNodeIds: new Set(['app_index']) })

    expect(renderer.focusNode('os')).toBe(false)
    expect(renderer.focusNode('missing')).toBe(false)
    expect(sigma.camera.animate).not.toHaveBeenCalled()
  })

  test('frameNeighborhood centres the camera on the node and its drawn neighbours', () => {
    const { renderer, sigma, container } = setup()
    Object.assign(container, { clientWidth: 1000, clientHeight: 800 })
    const displayed: Record<string, { x: number; y: number }> = {
      app_index_main: { x: 0.5, y: 0.5 },
      app_index: { x: 0.4, y: 0.5 },
      os: { x: 0.6, y: 0.7 },
    }
    sigma.getNodeDisplayData.mockImplementation((id: string) => displayed[id] ?? { x: 0.9, y: 0.9 })
    // The third-party neighbour is filtered out, so it must not widen the frame.
    renderer.setViewState({
      ...EMPTY_VIEW_STATE,
      visibleNodeIds: new Set(['app_index', 'app_index_main', 'os', 'lonely']),
    })

    expect(renderer.frameNeighborhood('app_index_main')).toBe(true)

    const [target] = sigma.camera.animate.mock.calls.at(-1) as unknown as [{ x: number; y: number; ratio: number }]
    expect(target.x).toBeCloseTo(0.5)
    expect(target.y).toBeCloseTo(0.6)
    // 200 × 200 px on screen, 904 × 560 px free: the taller side decides.
    expect(target.ratio).toBeCloseTo(200 / 560)
  })

  test('frameNeighborhood falls back to focus without neighbours and refuses hidden nodes', () => {
    const { renderer, sigma, container } = setup()
    Object.assign(container, { clientWidth: 1000, clientHeight: 800 })
    renderer.setViewState({ ...EMPTY_VIEW_STATE, visibleNodeIds: new Set(['lonely']) })

    expect(renderer.frameNeighborhood('lonely')).toBe(true)
    expect(sigma.camera.animate).toHaveBeenLastCalledWith(
      expect.objectContaining({ ratio: 0.2 }),
      expect.anything(),
    )
    expect(renderer.frameNeighborhood('os')).toBe(false)
    expect(renderer.frameNeighborhood('ghost')).toBe(false)
  })

  test('zoom and reset delegate to the Sigma camera', () => {
    const { renderer, sigma } = setup()

    renderer.zoomIn()
    renderer.zoomOut()
    renderer.resetCamera()

    expect(sigma.camera.animatedZoom).toHaveBeenCalledOnce()
    expect(sigma.camera.animatedUnzoom).toHaveBeenCalledOnce()
    expect(sigma.camera.animatedReset).toHaveBeenCalledOnce()
    expect(renderer.getCamera()).toEqual({ x: 0.5, y: 0.5, ratio: 1, angle: 0 })
  })

  test('setCamera jumps to the given camera and cancels any transition', () => {
    const { renderer, sigma } = setup()

    renderer.setCamera({ x: 0.31, y: 0.62, ratio: 0.4 })

    expect(sigma.camera.animate).toHaveBeenLastCalledWith(
      { x: 0.31, y: 0.62, ratio: 0.4, angle: 0 },
      { duration: 0 },
    )
  })

  test('reports the camera on the same throttle as the view', () => {
    vi.useFakeTimers()
    const onCameraChange = vi.fn()
    const { sigma } = setup({ onCameraChange })
    sigma.camera.getState.mockReturnValue({ x: 0.4, y: 0.6, ratio: 0.5, angle: 0 })

    for (let i = 0; i < 10; i += 1) sigma.cameraHandlers.get('updated')?.({ ratio: 0.5 })
    vi.runAllTimers()
    vi.useRealTimers()

    expect(onCameraChange).toHaveBeenCalledOnce()
    expect(onCameraChange).toHaveBeenCalledWith({ x: 0.4, y: 0.6, ratio: 0.5, angle: 0 })
  })

  test('reports where a visible node is on screen', () => {
    const { renderer } = setup()

    expect(renderer.getNodeViewportPosition('os')).toEqual({ x: 120, y: 80 })
    expect(renderer.getNodeViewportPosition('ghost')).toBeNull()
  })
})

describe('living graph loop', () => {
  function withAnimationFrames(run: (step: (now: number) => void) => void) {
    let pending: ((now: number) => void) | null = null
    const request = vi.fn((callback: (now: number) => void) => {
      pending = callback
      return 1
    })
    const cancel = vi.fn(() => {
      pending = null
    })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    try {
      run((now) => {
        const callback = pending
        pending = null
        callback?.(now)
      })
    } finally {
      vi.unstubAllGlobals()
    }
    return { request, cancel }
  }

  test('asks Sigma for one redraw per frame and never re-indexes the graph', () => {
    withAnimationFrames((step) => {
      const { sigma, renderer } = setup()
      sigma.refresh.mockClear()

      step(0)
      step(16)
      step(32)

      expect(sigma.scheduleRender).toHaveBeenCalledTimes(3)
      expect(sigma.refresh).not.toHaveBeenCalled()
      expect(renderer.getMotionQuality()).toBe('full')
    })
  })

  test('by default the observatory is still: nothing runs per frame at rest', () => {
    const { request } = withAnimationFrames(() => {
      const graph = buildGraph(adaptGraphify(makeRawGraph()))
      const container = { style: { cursor: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLElement
      const renderer = createSigmaRenderer(container, graph)

      expect(renderer.getMotionQuality()).toBe('still')
    })
    expect(request).not.toHaveBeenCalled()
  })

  test('reduced motion never starts the loop, and interaction still works', () => {
    const { request } = withAnimationFrames(() => {
      const model = adaptGraphify(makeRawGraph())
      const graph = buildGraph(model)
      const container = {
        style: { cursor: '' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLElement
      const renderer = createSigmaRenderer(container, graph, {}, { reducedMotion: true, living: true })
      const sigma = fake.FakeSigma.instances.at(-1)

      renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })

      expect(renderer.getMotionQuality()).toBe('still')
      expect(sigma?.scheduleRender).not.toHaveBeenCalled()
      expect(sigma?.refresh).toHaveBeenCalledWith({ skipIndexation: true })
    })
    expect(request).not.toHaveBeenCalled()
  })

  test('slow frames step the quality down until the loop stops by itself', () => {
    const { request } = withAnimationFrames((step) => {
      const { renderer } = setup()
      let now = 0
      // Two slow windows (full → calm → still), then time for the drift to ease to zero.
      for (let frame = 0; frame < 600; frame += 1) step((now += 40))

      expect(renderer.getMotionQuality()).toBe('still')
    })
    // Far fewer than the 600 frames offered: nothing keeps running once still.
    expect(request.mock.calls.length).toBeLessThan(400)
  })

  test('destroy cancels the pending frame', () => {
    const { cancel } = withAnimationFrames(() => {
      setup().renderer.destroy()
    })

    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('framingRatio', () => {
  // What Sigma draws of a 400 × 100 box at ratio 1 in 1440 × 900, inside its padding.
  const fit = 1440 - 2 * stagePaddingFor(1440, 900)
  const wide = { x: [0, 400], y: [0, 100] } as { x: [number, number]; y: [number, number] }
  const tall = { x: [0, 100], y: [0, 400] } as { x: [number, number]; y: [number, number] }

  const sides = (width: number) => ({ left: width, right: width, top: 0, bottom: 0 })

  test('zooms out just enough for a wide scope to clear the side panels', () => {
    // Drawn `fit` px wide at ratio 1; only 800px are free between the panels.
    expect(framingRatio(wide, 1440, 900, sides(320))).toBeCloseTo(fit / 800)
  })

  test('a padding in proportion to the view keeps the whole eye in the first picture', () => {
    expect(stagePaddingFor(1440, 900)).toBe(Math.round(900 * 0.145))
    expect(stagePaddingFor(390, 780)).toBe(57)
    expect(stagePaddingFor(200, 200)).toBe(48)
    expect(stagePaddingFor(4000, 3000)).toBe(160)
    expect(stagePaddingFor(0, 0)).toBe(72)
  })

  test('leaves Sigma\'s own fit alone when the graph already clears the panels', () => {
    expect(framingRatio(tall, 1440, 900, sides(320))).toBe(1)
    expect(framingRatio(wide, 1440, 900, sides(0))).toBe(1)
    expect(framingRatio(null, 1440, 900, sides(320))).toBe(1)
  })

  test('accounts for uneven sides and for what covers the top and the bottom', () => {
    // `fit` px wide, a quarter of that tall at ratio 1. A bottom sheet leaves 200 px of height.
    expect(framingRatio(wide, 1440, 900, { left: 0, right: 0, top: 100, bottom: 600 })).toBeCloseTo(fit / 4 / 200)
    // An explorer on the left only.
    expect(framingRatio(wide, 1440, 900, { left: 400, right: 0, top: 0, bottom: 0 })).toBeCloseTo(fit / 1040)
  })
})

describe('HUD occlusion', () => {
  // A full-height panel on the left of a 1000 × 800 viewport: the free area is x 300–1000.
  const leftPanel = { left: 0, top: 0, right: 300, bottom: 800 }

  function sized(cameraDuration = 0) {
    const parts = setup({}, cameraDuration)
    Object.assign(parts.container, { clientWidth: 1000, clientHeight: 800 })
    return parts
  }

  test('focus puts the node in the centre of the free area, not of the viewport', () => {
    const { renderer, sigma } = sized()
    renderer.setOccludedRects([leftPanel])

    renderer.focusNode('os')

    // Free centre x = 650, 150 px right of the viewport centre: at ratio 0.2 that is
    // 0.03 framed units, so the camera sits 0.03 left of the node (0.3).
    const [target] = sigma.camera.animate.mock.calls.at(-1) as unknown as [{ x: number; y: number; ratio: number }]
    expect(target.x).toBeCloseTo(0.27)
    expect(target.y).toBeCloseTo(0.7)
    expect(target.ratio).toBeCloseTo(0.2)
  })

  test('without HUD rectangles the camera targets are exactly as before', () => {
    const { renderer, sigma } = sized()

    renderer.focusNode('os')

    expect(sigma.camera.animate).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 0.3, y: 0.7, ratio: 0.2 }),
      expect.anything(),
    )
    expect(sigma.viewportToFramedGraph).not.toHaveBeenCalled()
  })

  test('reset frames the drawn graph in the free area', () => {
    const { renderer, sigma } = sized()
    renderer.setViewState({ ...EMPTY_VIEW_STATE, visibleNodeIds: new Set(['app_index', 'app_index_main', 'os']) })
    renderer.setOccludedRects([leftPanel])

    renderer.resetCamera()

    expect(sigma.camera.animatedReset).not.toHaveBeenCalled()
    const [target] = sigma.camera.animate.mock.calls.at(-1) as unknown as [{ x: number; ratio: number }]
    // Shifted so the graph's centre lands at x 650, and zoomed out to fit 700 px instead of 1000.
    expect(target.x).toBeLessThan(0.5)
    expect(target.ratio).toBeGreaterThan(1)
  })

  test('a selected node the HUD has just covered is brought back into the free area', () => {
    const { renderer, sigma } = sized()
    // 'os' is drawn at (300, 700): right at the edge of the panel.
    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })

    renderer.setOccludedRects([leftPanel])

    expect(sigma.camera.animate).toHaveBeenCalledOnce()
    const [target] = sigma.camera.animate.mock.calls[0] as unknown as [{ x: number; ratio: number }]
    expect(target.ratio).toBe(1)
    expect(target.x).toBeCloseTo(0.3 - 0.15)
  })

  test('a selected node whose name runs under a panel is moved, node and plate together', () => {
    const { renderer, sigma } = sized()
    // One frame drawn, so the label layer knows its font.
    const labelContext = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      strokeText: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const drawLabel = sigma.settings.defaultDrawNodeLabel as (c: CanvasRenderingContext2D, d: object, s: object) => void
    sigma.emit('beforeRender')
    drawLabel(labelContext, { key: 'x', label: 'x', x: 10, y: 10, size: 4 }, { labelSize: 12, labelFont: 'sans-serif', labelWeight: '500' })
    sigma.emit('afterRender')
    // The node at x 700 is clear of a panel from x 800, but its 254 px plate is not.
    sigma.getNodeDisplayData.mockImplementation(() => ({ x: 0.7, y: 0.4, size: 4, label: 'a selected node with a long name' }))
    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })

    renderer.setOccludedRects([{ left: 800, top: 0, right: 1000, bottom: 800 }])

    expect(sigma.camera.animate).toHaveBeenCalledOnce()
    // The middle of node and plate (x 827 on screen) goes to the free centre (x 400).
    const [target] = sigma.camera.animate.mock.calls[0] as unknown as [{ x: number }]
    expect(target.x).toBeCloseTo(0.827 + 0.1)
  })

  test('a selected node that stays visible does not move the camera', () => {
    const { renderer, sigma } = sized()
    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })

    renderer.setOccludedRects([{ left: 800, top: 0, right: 1000, bottom: 800 }])

    expect(sigma.camera.animate).not.toHaveBeenCalled()
  })

  test('while the camera travels the check waits, then runs once it has landed', () => {
    vi.useFakeTimers()
    const { renderer, sigma } = sized()
    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })
    sigma.camera.isAnimated.mockReturnValue(true)

    renderer.setOccludedRects([leftPanel])
    expect(sigma.camera.animate).not.toHaveBeenCalled()

    sigma.camera.isAnimated.mockReturnValue(false)
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    expect(sigma.camera.animate).toHaveBeenCalledOnce()
  })

  test('a node off screen is reached by a flight: up a little, then down onto it', async () => {
    const { renderer, sigma } = sized(250)
    // Drawn at x 2000: outside the 1000 px view.
    sigma.getNodeDisplayData.mockImplementation(() => ({ x: 2, y: 0.4 }))

    renderer.focusNode('os')
    expect(sigma.camera.animate).toHaveBeenCalledOnce()
    const [lift] = sigma.camera.animate.mock.calls.at(-1) as unknown as [{ x: number; ratio: number }]
    expect(lift.ratio).toBeGreaterThan(1)
    await Promise.resolve()
    await Promise.resolve()

    const [landing] = sigma.camera.animate.mock.calls.at(-1) as unknown as [{ x: number; ratio: number }]
    expect(sigma.camera.animate).toHaveBeenCalledTimes(2)
    expect(landing).toMatchObject({ x: 2, ratio: 0.2 })
  })

  test('the user grabbing the camera ends a flight halfway', async () => {
    const { renderer, sigma, listeners } = sized(250)
    sigma.getNodeDisplayData.mockImplementation(() => ({ x: 2, y: 0.4 }))

    renderer.focusNode('os')
    listeners.get('pointerdown')?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(sigma.camera.animate).toHaveBeenCalledOnce()
  })

  test('a framing reads the HUD as it is at that moment, before any report arrives', () => {
    const { renderer, sigma } = sized()
    let hud: { left: number; top: number; right: number; bottom: number }[] = []
    renderer.setOcclusionSource(() => hud)
    // The panel appears in the same update as the request: no report yet.
    hud = [leftPanel]

    renderer.focusNode('os')

    const [target] = sigma.camera.animate.mock.calls.at(-1) as unknown as [{ x: number }]
    expect(target.x).toBeCloseTo(0.27)
  })

  test('a camera restored from a link is not moved while the HUD settles', () => {
    const { renderer, sigma, listeners } = sized()
    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })

    renderer.setCamera({ x: 0.4, y: 0.6, ratio: 0.5 })
    renderer.setOccludedRects([leftPanel])
    expect(sigma.camera.animate).toHaveBeenCalledOnce() // the restore itself

    // Once the user acts on the graph, the HUD keeps the selection in view again.
    listeners.get('pointerdown')?.()
    renderer.setOccludedRects([{ ...leftPanel, right: 320 }])
    expect(sigma.camera.animate).toHaveBeenCalledTimes(2)
  })

  test('a new selection after a restored camera is kept in view again', () => {
    const { renderer, sigma } = sized()
    renderer.setCamera({ x: 0.4, y: 0.6, ratio: 0.5 })

    renderer.setViewState({ ...EMPTY_VIEW_STATE, selectedNodeId: 'os' })
    renderer.setOccludedRects([leftPanel])

    expect(sigma.camera.animate).toHaveBeenCalledTimes(2)
  })

  test('the same rectangles twice change nothing; new ones redraw the labels', () => {
    const { renderer, sigma } = sized()

    renderer.setOccludedRects([leftPanel])
    renderer.setOccludedRects([{ ...leftPanel }])
    expect(sigma.scheduleRender).toHaveBeenCalledTimes(1)

    renderer.setOccludedRects([])
    expect(sigma.scheduleRender).toHaveBeenCalledTimes(2)
  })

  test('labels are kept out of the HUD the renderer was told about', () => {
    const { renderer, sigma } = sized()
    renderer.setOccludedRects([leftPanel])
    const fillText = vi.fn()
    const labelContext = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      strokeText: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D
    const drawLabel = sigma.settings.defaultDrawNodeLabel as (c: CanvasRenderingContext2D, d: object, s: object) => void
    const settings = { labelSize: 12, labelFont: 'sans-serif', labelWeight: '500' }

    sigma.emit('beforeRender')
    drawLabel(labelContext, { key: 'hidden', label: 'under the panel', x: 120, y: 300, size: 4 }, settings)
    drawLabel(labelContext, { key: 'free', label: 'in the free area', x: 600, y: 300, size: 4 }, settings)
    sigma.emit('afterRender')

    expect(fillText.mock.calls.map(([text]) => text)).toEqual(['in the free area'])
  })
})
