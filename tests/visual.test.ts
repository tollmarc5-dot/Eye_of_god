import { describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import { buildGraph, nodeSize } from '@/graph'
import {
  createFrameMonitor,
  createMotionUniforms,
  initialQuality,
  isAnimated,
  MONITOR_WINDOW_FRAMES,
  resolveEffects,
  SLOW_FRAME_MS,
  stepUniforms,
} from '@/renderer/motion'
import {
  computeFocus,
  createReducers,
  EMPTY_VIEW_STATE,
  HOVER_ACCENT,
  restGlow,
  SELECTED_ACCENT,
  type RendererViewState,
} from '@/renderer/reducers'
import { CANVAS_THEME } from '@/styles/canvas-theme'
import {
  communityColor,
  communityEdgeColor,
  communityHue,
  hexToUnitRgb,
  mutedCommunityColor,
  PALETTE_HUE_END,
  PALETTE_HUE_START,
} from '@/utils/color'
import { makeRawGraph } from './fixtures'

const COMMUNITY_IDS = Array.from({ length: 169 }, (_value, id) => id)

function lightness(hex: string): number {
  const [red, green, blue] = hexToUnitRgb(hex)
  return (Math.max(red, green, blue) + Math.min(red, green, blue)) / 2
}

describe('palette', () => {
  test('every community hue sits on the cyan → blue → violet arc', () => {
    for (const id of COMMUNITY_IDS) {
      expect(communityHue(id)).toBeGreaterThanOrEqual(PALETTE_HUE_START)
      expect(communityHue(id)).toBeLessThanOrEqual(PALETTE_HUE_END)
    }
    expect(PALETTE_HUE_START).toBeGreaterThanOrEqual(185)
    expect(PALETTE_HUE_END).toBeLessThanOrEqual(285)
  })

  test('blue is the strongest channel of every node colour: no red, yellow, green or orange', () => {
    const colors = COMMUNITY_IDS.flatMap((id) => [communityColor(id), mutedCommunityColor(id)])

    for (const color of [...colors, communityColor(null)]) {
      const [red, green, blue] = hexToUnitRgb(color)
      expect(blue).toBeGreaterThanOrEqual(red)
      expect(blue).toBeGreaterThanOrEqual(green)
    }
  })

  test('communities stay distinguishable and bright enough over the dark background', () => {
    const colors = COMMUNITY_IDS.map((id) => communityColor(id))

    expect(new Set(colors).size).toBe(169)
    expect(Math.min(...colors.map(lightness))).toBeGreaterThan(0.5)
    expect(communityColor(7)).toBe(communityColor(7))
  })

  test('third-party code is dimmer than project code of the same community', () => {
    for (const id of COMMUNITY_IDS) {
      expect(lightness(mutedCommunityColor(id))).toBeLessThan(lightness(communityColor(id)))
    }
  })

  test('edges of the active community are lifted, but stay far below node brightness', () => {
    const resting = lightness(communityEdgeColor(3))
    const active = lightness(communityEdgeColor(3, true))

    expect(active).toBeGreaterThan(resting)
    expect(active).toBeLessThan(lightness(communityColor(3)))
  })

  test('hexToUnitRgb converts the interaction colour for WebGL', () => {
    expect(hexToUnitRgb('#ff0080')).toEqual([1, 0, 128 / 255])
    expect(hexToUnitRgb(CANVAS_THEME.accent)[2]).toBe(1)
  })
})

describe('level of detail', () => {
  test('every effect grows as the camera gets closer', () => {
    const far = resolveEffects('universe', 'full')
    const medium = resolveEffects('structure', 'full')
    const close = resolveEffects('detail', 'full')

    expect(far.amplitude).toBeLessThan(medium.amplitude)
    expect(medium.amplitude).toBeLessThan(close.amplitude)
    expect(far.glow).toBeLessThan(medium.glow)
    expect(medium.glow).toBeLessThanOrEqual(close.glow)
    expect(far.ambientFlow).toBe(0)
    expect(medium.ambientFlow).toBeLessThan(close.ambientFlow)
  })

  test('a node never drifts more than a few pixels from its base position', () => {
    for (const level of ['universe', 'structure', 'detail'] as const) {
      expect(resolveEffects(level, 'full').amplitude).toBeLessThanOrEqual(3)
    }
  })

  test('calm keeps the drift smaller and drops the ambient data flow', () => {
    const full = resolveEffects('detail', 'full')
    const calm = resolveEffects('detail', 'calm')

    expect(calm.amplitude).toBeLessThan(full.amplitude)
    expect(calm.ambientFlow).toBe(0)
    expect(calm.focusFlow).toBe(1)
    expect(calm.glow).toBe(full.glow)
  })

  test('still removes continuous motion but keeps the static glow', () => {
    const still = resolveEffects('detail', 'still')

    expect(still).toMatchObject({ amplitude: 0, ambientFlow: 0, focusFlow: 0 })
    expect(still.glow).toBe(resolveEffects('detail', 'full').glow)
  })
})

describe('reduced motion', () => {
  test('starts still, and still means nothing animates', () => {
    expect(initialQuality(true)).toBe('still')
    expect(initialQuality(false)).toBe('full')
    expect(isAnimated('still')).toBe(false)
    expect(isAnimated('calm')).toBe(true)
  })
})

describe('frame monitor', () => {
  const feed = (monitor: ReturnType<typeof createFrameMonitor>, frameMs: number, frames = MONITOR_WINDOW_FRAMES) => {
    for (let frame = 0; frame < frames; frame += 1) monitor.sample(frameMs)
    return monitor.quality
  }

  test('keeps full quality while frames are fast', () => {
    expect(feed(createFrameMonitor('full'), 16.7, MONITOR_WINDOW_FRAMES * 3)).toBe('full')
  })

  test('steps down one level per slow window, down to still', () => {
    const monitor = createFrameMonitor('full')

    expect(feed(monitor, SLOW_FRAME_MS + 6)).toBe('calm')
    expect(feed(monitor, SLOW_FRAME_MS + 6)).toBe('still')
    expect(feed(monitor, SLOW_FRAME_MS + 6)).toBe('still')
  })

  test('does not judge before a whole window has been seen', () => {
    expect(feed(createFrameMonitor('full'), 80, MONITOR_WINDOW_FRAMES - 1)).toBe('full')
  })

  test('never raises the quality again, so it cannot oscillate', () => {
    const monitor = createFrameMonitor('full')
    feed(monitor, 40)

    expect(feed(monitor, 8, MONITOR_WINDOW_FRAMES * 4)).toBe('calm')
  })

  test('ignores the long gap of a hidden tab', () => {
    const monitor = createFrameMonitor('full')
    feed(monitor, 16, MONITOR_WINDOW_FRAMES - 1)

    monitor.sample(60_000)
    monitor.sample(16)

    expect(monitor.quality).toBe('full')
  })
})

describe('animation state', () => {
  test('uniforms ease towards a new level instead of jumping', () => {
    const uniforms = createMotionUniforms(resolveEffects('universe', 'full'))
    const target = resolveEffects('detail', 'full')
    const start = uniforms.amplitude

    stepUniforms(uniforms, target, 1.5)

    expect(uniforms.time).toBe(1.5)
    expect(uniforms.amplitude).toBeGreaterThan(start)
    expect(uniforms.amplitude - start).toBeLessThan((target.amplitude - start) * 0.2)
  })

  test('they settle exactly on the target', () => {
    const uniforms = createMotionUniforms(resolveEffects('universe', 'full'))
    const target = resolveEffects('detail', 'still')

    for (let frame = 0; frame < 400; frame += 1) stepUniforms(uniforms, target, frame / 60)

    expect(uniforms).toMatchObject(target)
  })
})

describe('node visual intensity', () => {
  const model = adaptGraphify(makeRawGraph())

  function setup(view: Partial<RendererViewState> = {}, hoveredNodeId: string | null = null) {
    const graph = buildGraph(model)
    const state: RendererViewState = { ...EMPTY_VIEW_STATE, ...view }
    const focus = computeFocus(graph, state, hoveredNodeId)
    const reducers = createReducers(graph, () => state, () => focus)
    return {
      graph,
      node: (id: string) => reducers.nodeReducer(id, { ...graph.getNodeAttributes(id) }) as Record<string, unknown>,
      edge: (id: string) => reducers.edgeReducer(id, { ...graph.getEdgeAttributes(id) }) as Record<string, unknown>,
    }
  }

  test('glow grows with degree: hubs are present, leaves discreet but visible', () => {
    const leaf = restGlow(nodeSize(0), false)
    const hub = restGlow(nodeSize(60), false)

    expect(leaf).toBeGreaterThan(0.25)
    expect(restGlow(nodeSize(4), false)).toBeGreaterThan(leaf)
    expect(hub).toBeGreaterThan(restGlow(nodeSize(4), false))
    expect(hub).toBeLessThanOrEqual(1)
  })

  test('third-party code glows less than project code of the same degree', () => {
    expect(restGlow(nodeSize(10), true)).toBeLessThan(restGlow(nodeSize(10), false))
    expect(setup().node('app_lib_xlsx_min_s').glow).toBeLessThan(setup().node('app_index').glow as number)
  })

  test('at rest every node carries the glow of its degree and no accent', () => {
    const { node, graph } = setup()

    expect(node('app_index_main').glow).toBe(restGlow(graph.getNodeAttribute('app_index_main', 'size'), false))
    expect(node('app_index_main').accent).toBeUndefined()
    expect(node('app_index_main').glow).toBeGreaterThan(node('lonely').glow as number)
  })

  test('hover: the node grows and takes the cyan halo, without the ring', () => {
    const { node, graph } = setup({}, 'app_index')
    const hovered = node('app_index')

    expect(hovered.size).toBeGreaterThan(graph.getNodeAttribute('app_index', 'size'))
    expect(hovered).toMatchObject({ glow: 1, accent: HOVER_ACCENT, highlighted: true })
    expect(HOVER_ACCENT).toBeLessThan(0.75)
  })

  test('selection answers more strongly than hover and adds the ring', () => {
    const hovered = setup({}, 'app_index').node('app_index')
    const selected = setup({ selectedNodeId: 'app_index' }).node('app_index')

    expect(selected.size).toBeGreaterThan(hovered.size as number)
    expect(selected).toMatchObject({ glow: 1, accent: SELECTED_ACCENT })
    expect(SELECTED_ACCENT).toBeGreaterThanOrEqual(0.75)
  })

  test('neighbours gain presence, the rest of the graph loses its glow', () => {
    const { node, graph } = setup({ selectedNodeId: 'app_index' })
    const neighbour = node('app_index_main')

    expect(neighbour.glow).toBeGreaterThan(restGlow(graph.getNodeAttribute('app_index_main', 'size'), false))
    expect(neighbour.size).toBeGreaterThan(graph.getNodeAttribute('app_index_main', 'size'))
    expect(node('os')).toMatchObject({ glow: 0, color: CANVAS_THEME.nodeDimmed })
  })

  test('the selected node keeps its ring while another node is hovered', () => {
    const { node } = setup({ selectedNodeId: 'lonely' }, 'app_index')

    expect(node('lonely')).toMatchObject({ accent: SELECTED_ACCENT, highlighted: true })
    expect(node('app_index').accent).toBe(HOVER_ACCENT)
  })

  test('only the relations of the active node carry the data flow', () => {
    const { edge } = setup({ selectedNodeId: 'app_index' })

    expect(edge('app_index|contains|app_index_main')).toMatchObject({ flow: 1, color: CANVAS_THEME.edgeFocus })
    expect(edge('app_index_main|imports|os').flow).toBeUndefined()
    expect(setup().edge('app_index|contains|app_index_main').flow).toBeUndefined()
  })

  test('relations inside the active community are drawn a little brighter', () => {
    const resting = setup().edge('app_index|contains|app_index_main').color
    const active = setup({ activeCommunity: 0 }).edge('app_index|contains|app_index_main').color

    expect(resting).toBe(communityEdgeColor(0))
    expect(active).toBe(communityEdgeColor(0, true))
  })
})
