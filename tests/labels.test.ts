import { describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { applyPositions, buildGraph } from '@/graph'
import { createLabelLayer, drawNodeHover, labelRankOf, type LabelData } from '@/renderer/draw-labels'
import {
  compareCandidates,
  createLabelPlacer,
  LABEL_RANK,
  placeLabels,
  plateBox,
  ringBox,
  type LabelBox,
  type LabelCandidate,
  type LabelMetrics,
  type LabelRank,
} from '@/renderer/label-layout'
import { computeFocus, createReducers, EMPTY_VIEW_STATE, type RendererViewState } from '@/renderer/reducers'
import { makeRawGraph } from './fixtures'

const CHAR_WIDTH = 7
const LABEL_SIZE = 12
/** Monospace stand-in for canvas text measurement: every character is 7 px wide. */
const metrics: LabelMetrics = { labelSize: LABEL_SIZE, measure: (label) => label.length * CHAR_WIDTH }

function candidate(key: string, x: number, y: number, overrides: Partial<LabelCandidate> = {}): LabelCandidate {
  return { key, label: key, x, y, size: 4, rank: LABEL_RANK.regular, ...overrides }
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

const drawnKeys = (candidates: readonly LabelCandidate[]): string[] =>
  placeLabels(candidates, metrics).map((placed) => placed.candidate.key)

/** Small deterministic generator (LCG), so the dense scenes are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function denseScene(count: number, seed: number): LabelCandidate[] {
  const random = seeded(seed)
  const ranks: LabelRank[] = [LABEL_RANK.regular, LABEL_RANK.regular, LABEL_RANK.regular, LABEL_RANK.aggregate]
  return Array.from({ length: count }, (_, i) =>
    candidate(`node-${i}`, Math.round(random() * 1440), Math.round(random() * 900), {
      label: `label ${'x'.repeat(Math.floor(random() * 24))}`,
      size: 2 + Math.floor(random() * 14),
      rank: ranks[i % ranks.length],
    }),
  )
}

describe('label placement', () => {
  test('two labels that would overlap: the larger node keeps its place, the other moves to the left', () => {
    const hub = candidate('hub', 100, 100, { size: 12 })
    const leaf = candidate('leaf', 110, 102, { size: 3 })

    const placed = placeLabels([leaf, hub], metrics)

    expect(placed.map(({ candidate: c, side }) => [c.key, side])).toEqual([
      ['hub', 'right'],
      ['leaf', 'left'],
    ])
    expect(overlaps(placed[0]!.box, placed[1]!.box)).toBe(false)
  })

  test('a label with no free side is left out of the frame, never drawn on top of another', () => {
    const hub = candidate('a-long-hub-label', 100, 100, { size: 12 })
    // Its node sits in the middle of the hub's label: both of its sides are taken.
    const leaf = candidate('leaf-label', 150, 100, { size: 3 })
    const left = candidate('left-blocker-label', 20, 100, { size: 10 })

    expect(drawnKeys([hub, leaf, left])).toEqual(['a-long-hub-label', 'left-blocker-label'])
  })

  test('a dense scene is drawn without a single overlap', () => {
    const placed = placeLabels(denseScene(600, 7), metrics)

    expect(placed.length).toBeGreaterThan(100)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!.box, placed[j]!.box), `${placed[i]!.candidate.key} × ${placed[j]!.candidate.key}`).toBe(false)
      }
    }
  })

  test('is deterministic: the same candidates in any order give the same labels on the same sides', () => {
    const scene = denseScene(300, 11)
    const shuffled = [...scene].sort(() => 0).reverse()

    const summary = (candidates: readonly LabelCandidate[]) =>
      placeLabels(candidates, metrics).map(({ candidate: c, side }) => `${c.key}:${side}`)

    expect(summary(shuffled)).toEqual(summary(scene))
  })

  test('priority: rank first, then node size, then the id', () => {
    const order = [
      candidate('z-regular-big', 0, 0, { size: 20 }),
      candidate('b-regular', 0, 0, { size: 5 }),
      candidate('a-regular', 0, 0, { size: 5 }),
      candidate('aggregate', 0, 0, { rank: LABEL_RANK.aggregate, size: 2 }),
      candidate('forced', 0, 0, { rank: LABEL_RANK.forced, size: 1 }),
      candidate('hovered', 0, 0, { rank: LABEL_RANK.hovered }),
      candidate('selected', 0, 0, { rank: LABEL_RANK.selected }),
    ].sort(compareCandidates)

    expect(order.map((c) => c.key)).toEqual([
      'selected',
      'hovered',
      'forced',
      'aggregate',
      'z-regular-big',
      'a-regular',
      'b-regular',
    ])
  })

  test('the selected plate and its node are reserved: they are never in the output and push others away', () => {
    const selected = candidate('selected', 200, 200, { size: 10, rank: LABEL_RANK.selected })
    const onPlate = candidate('under-the-plate', 230, 202, { size: 30 })
    const onRing = candidate('r', 175, 200, { size: 2 })

    const placed = placeLabels([onPlate, onRing, selected], metrics)

    expect(placed.map((p) => p.candidate.key)).not.toContain('selected')
    const reserved = [plateBox(selected, metrics.measure('selected'), LABEL_SIZE), ringBox(selected)]
    for (const label of placed) {
      for (const box of reserved) expect(overlaps(label.box, box), label.candidate.key).toBe(false)
    }
  })

  test('hovered and selected plates are both kept, even when they touch', () => {
    const selected = candidate('selected', 200, 200, { rank: LABEL_RANK.selected })
    const hovered = candidate('hovered', 205, 200, { rank: LABEL_RANK.hovered })

    // Plates are drawn by Sigma; nothing here may drop them, and no text is added for them.
    expect(placeLabels([selected, hovered], metrics)).toEqual([])
  })

  test('forced labels (path waypoints) are always drawn, even with no free side', () => {
    const hub = candidate('a-long-hub-label', 100, 100, { size: 12 })
    const left = candidate('left-blocker-label', 20, 100, { size: 10 })
    const waypoint = candidate('waypoint', 150, 100, { size: 3, rank: LABEL_RANK.forced })

    const placed = placeLabels([hub, left, waypoint], metrics)

    expect(placed.map((p) => [p.candidate.key, p.side])).toContainEqual(['waypoint', 'right'])
    // Placed before the regular labels, it is the hub that gives way.
    expect(placed[0]?.candidate.key).toBe('waypoint')
  })

  test('the placer reuses the previous placement while the frame does not change', () => {
    const place = createLabelPlacer()
    const measure = vi.fn(metrics.measure)
    const scene = denseScene(50, 3)

    const first = place(scene, { labelSize: LABEL_SIZE, measure })
    const calls = measure.mock.calls.length
    const second = place(scene.map((c) => ({ ...c })), { labelSize: LABEL_SIZE, measure })

    expect(second).toBe(first)
    expect(measure.mock.calls.length).toBe(calls)

    const moved = place(scene.map((c, i) => (i === 0 ? { ...c, x: c.x + 1 } : c)), { labelSize: LABEL_SIZE, measure })
    expect(moved).not.toBe(first)
  })
})

describe('label ranks come from the reducers', () => {
  const model = adaptGraphify(makeRawGraph())
  const graph = buildGraph(model)
  applyPositions(graph, new Map(model.nodes.map((node, i) => [node.id, { x: i * 10, y: i * 5 }])))

  function rankOf(view: Partial<RendererViewState>, nodeId: string, hoveredNodeId: string | null = null): LabelRank {
    const state = { ...EMPTY_VIEW_STATE, ...view }
    const focus = computeFocus(graph, state, hoveredNodeId)
    const reducers = createReducers(graph, () => state, () => focus)
    const display = reducers.nodeReducer(nodeId, { ...graph.getNodeAttributes(nodeId) })
    return labelRankOf({ x: 0, y: 0, size: 1, ...display } as LabelData)
  }

  test('selected, hovered, path waypoint and plain nodes', () => {
    expect(rankOf({ selectedNodeId: 'app_index' }, 'app_index')).toBe(LABEL_RANK.selected)
    expect(rankOf({ selectedNodeId: 'app_index' }, 'app_index_main', 'app_index_main')).toBe(LABEL_RANK.hovered)
    expect(
      rankOf(
        { highlight: { kind: 'path', nodeIds: new Set(['app_index', 'app_index_main']), edgeIds: new Set() } },
        'app_index_main',
      ),
    ).toBe(LABEL_RANK.forced)
    expect(rankOf({}, 'os')).toBe(LABEL_RANK.regular)
  })

  test('an aggregate is ranked above plain nodes', () => {
    expect(labelRankOf({ x: 0, y: 0, size: 9, label: 'Core · 3', aggregate: 1 })).toBe(LABEL_RANK.aggregate)
  })
})

/** Records what a 2D context is asked to draw. */
function recordingContext() {
  const texts: { text: string; x: number; y: number }[] = []
  const rects: number[][] = []
  const context = {
    font: '',
    textBaseline: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    measureText: vi.fn((text: string) => ({ width: text.length * CHAR_WIDTH })),
    strokeText: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => void texts.push({ text, x, y })),
    beginPath: vi.fn(),
    roundRect: vi.fn((...args: number[]) => void rects.push(args)),
    fill: vi.fn(),
    stroke: vi.fn(),
  }
  return { context: context as unknown as CanvasRenderingContext2D, texts, rects, measureText: context.measureText }
}

const SETTINGS = { labelSize: LABEL_SIZE, labelFont: 'IBM Plex Sans', labelWeight: '500' }

describe('label layer', () => {
  test('collects a whole frame, then draws only the labels that were placed', () => {
    const layer = createLabelLayer()
    const { context, texts } = recordingContext()

    layer.reset()
    layer.collect(context, { key: 'hub', label: 'hub-label', x: 100, y: 100, size: 12 }, SETTINGS)
    layer.collect(context, { key: 'inside', label: 'inside', x: 150, y: 100, size: 3 }, SETTINGS)
    layer.collect(context, { key: 'left', label: 'left-blocker-label', x: 20, y: 100, size: 10 }, SETTINGS)
    layer.collect(context, { key: 'none', label: null, x: 400, y: 400, size: 3 }, SETTINGS)
    expect(texts).toEqual([])

    layer.draw()

    expect(texts.map((t) => t.text).sort()).toEqual(['hub-label', 'left-blocker-label'])
  })

  test('a selected node gets no second label: Sigma draws it on its plate', () => {
    const layer = createLabelLayer()
    const { context, texts } = recordingContext()

    layer.collect(context, { key: 's', label: 'selected', x: 10, y: 10, size: 4, highlighted: true, accent: 1 }, SETTINGS)
    layer.draw()

    expect(texts).toEqual([])
  })

  test('each frame starts empty, and text is measured once per label across frames', () => {
    const layer = createLabelLayer()
    const { context, texts, measureText } = recordingContext()
    const frame = () => {
      layer.reset()
      layer.collect(context, { key: 'a', label: 'alpha', x: 10, y: 10, size: 4 }, SETTINGS)
      layer.draw()
    }

    frame()
    frame()
    layer.reset()
    layer.draw()

    expect(texts.map((t) => t.text)).toEqual(['alpha', 'alpha'])
    expect(measureText).toHaveBeenCalledTimes(1)
  })

  test('the hover plate is drawn exactly where the layout reserves it', () => {
    const { context, rects } = recordingContext()
    const data = { key: 'n', label: 'node name', x: 300, y: 120, size: 9 }

    drawNodeHover(context, data, SETTINGS)

    const box = plateBox({ ...data, rank: LABEL_RANK.selected }, 'node name'.length * CHAR_WIDTH, LABEL_SIZE)
    expect(rects[0]?.slice(0, 4)).toEqual([box.left, box.top, box.right - box.left, box.bottom - box.top])
  })
})

describe('labels and the HUD', () => {
  // A panel covering x 200–400, y 0–300 of a 1000 × 800 viewport.
  const panel: LabelBox = { left: 200, top: 0, right: 400, bottom: 300 }
  const inViewport = { reserved: [panel], width: 1000, height: 800 }
  const intersects = (a: LabelBox, b: LabelBox) => overlaps(a, b)

  test('a label that would enter the HUD goes to the other side of its node', () => {
    // On the right it would run from 158 to 228, into the panel; on the left it is clear.
    const placed = placeLabels([candidate('near-panel', 150, 100)], metrics, inViewport)

    expect(placed.map((label) => label.side)).toEqual(['left'])
  })

  test('with no clear side the label is left out, never drawn into the HUD', () => {
    expect(placeLabels([candidate('under-panel', 300, 100)], metrics, inViewport)).toEqual([])
  })

  test('in a dense scene no label touches the HUD, and none touches another', () => {
    const reserved = [panel, { left: 600, top: 500, right: 1000, bottom: 800 }]
    const placed = placeLabels(denseScene(600, 5), metrics, { reserved, width: 1440, height: 900 })

    expect(placed.length).toBeGreaterThan(50)
    for (const label of placed) {
      for (const zone of reserved) expect(intersects(label.box, zone), label.candidate.key).toBe(false)
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i]!.box, placed[j]!.box)).toBe(false)
    }
  })

  test('the selected plate is kept under the HUD too: Sigma draws it, and it still reserves its room', () => {
    const selected = candidate('selected', 380, 100, { rank: LABEL_RANK.selected })
    const neighbour = candidate('neighbour', 420, 104)

    const placed = placeLabels([neighbour, selected], metrics, inViewport)

    expect(placed.map((label) => label.candidate.key)).not.toContain('selected')
    const plate = plateBox(selected, metrics.measure('selected'), LABEL_SIZE)
    for (const label of placed) expect(overlaps(label.box, plate)).toBe(false)
  })

  test('a forced label keeps its priority but never enters the HUD', () => {
    const waypoint = candidate('waypoint', 150, 100, { rank: LABEL_RANK.forced })
    expect(placeLabels([waypoint], metrics, inViewport).map((label) => label.side)).toEqual(['left'])

    const buried = candidate('buried', 300, 100, { rank: LABEL_RANK.forced })
    expect(placeLabels([buried], metrics, inViewport)).toEqual([])
  })

  test('labels never run past the edges of the viewport', () => {
    // Close to the right edge: drawn on the left of its node.
    expect(placeLabels([candidate('edge-right', 990, 600)], metrics, inViewport).map((l) => l.side)).toEqual(['left'])
    // Cut on both sides by the top edge: left out.
    expect(placeLabels([candidate('edge-top', 700, 2)], metrics, inViewport)).toEqual([])
  })

  test('the placer computes again when the HUD changes, and only then', () => {
    const place = createLabelPlacer()
    const scene = denseScene(40, 9)

    const first = place(scene, metrics, { reserved: [], width: 1440, height: 900 })
    expect(place(scene, metrics, { reserved: [], width: 1440, height: 900 })).toBe(first)
    expect(place(scene, metrics, inViewport)).not.toBe(first)
  })
})
