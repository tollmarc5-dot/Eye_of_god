// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import Graph from 'graphology'
import type { KnowledgeGraph } from '@/graph'
import {
  computeConstellations,
  createUniverseLayer,
  MAX_NEBULAE,
  eyePresence,
  irisRings,
  MIN_CONSTELLATION_SIZE,
  STAR_TILE,
} from '@/renderer/universe'

/** Community c gets n nodes on a square of side 2 around (100·c, 0); the last t are third-party. */
function graphOf(communities: readonly { id: number; size: number; thirdParty?: number }[]): KnowledgeGraph {
  const graph: KnowledgeGraph = new Graph()
  for (const { id, size, thirdParty = 0 } of communities) {
    for (let i = 0; i < size; i++) {
      graph.addNode(`c${id}-n${i}`, {
        label: `n${i}`,
        x: 100 * id + (i % 2 ? 1 : -1),
        y: i % 4 < 2 ? 1 : -1,
        size: 3,
        community: id,
        isThirdParty: i >= size - thirdParty,
      })
    }
  }
  return graph
}

describe('constellations', () => {
  test('one per community with enough drawn nodes: centroid, spread, largest first', () => {
    const graph = graphOf([
      { id: 1, size: 4 },
      { id: 2, size: 8 },
      { id: 3, size: MIN_CONSTELLATION_SIZE - 1 },
    ])

    const constellations = computeConstellations(graph, () => true)

    expect(constellations.map((c) => [c.communityId, c.count])).toEqual([
      [2, 8],
      [1, 4],
    ])
    expect(constellations[0]).toMatchObject({ x: 200, y: 0, isThirdParty: false })
    expect(constellations[0]!.spread).toBeCloseTo(Math.SQRT2)
  })

  test('only drawn nodes count; equal sizes are ordered by id, whatever the insertion order', () => {
    const graph = graphOf([
      { id: 9, size: 5 },
      { id: 4, size: 5 },
    ])

    expect(computeConstellations(graph, () => true).map((c) => c.communityId)).toEqual([4, 9])
    expect(computeConstellations(graph, (id) => !id.startsWith('c9'))).toHaveLength(1)
    expect(computeConstellations(graph, () => false)).toEqual([])
  })

  test('a community that is mostly third-party code is marked for the muted family', () => {
    const graph = graphOf([
      { id: 1, size: 6, thirdParty: 4 },
      { id: 2, size: 6, thirdParty: 3 },
    ])
    const byId = new Map(computeConstellations(graph, () => true).map((c) => [c.communityId, c.isThirdParty]))

    expect(byId.get(1)).toBe(true)
    expect(byId.get(2)).toBe(false)
  })
})

describe('universe layer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  function recordingCanvas() {
    const calls = { fillRect: 0, drawImage: 0, clearRect: 0 }
    /** Every blit: [x, y, width]. Star tiles are STAR_TILE wide, nebulae their own size. */
    const blits: number[][] = []
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(() => void (calls.clearRect += 1)),
      fillRect: vi.fn(() => void (calls.fillRect += 1)),
      drawImage: vi.fn((_image: unknown, x: number, y: number, w: number) => {
        calls.drawImage += 1
        blits.push([x, y, w])
      }),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      bezierCurveTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 1440 })
    Object.defineProperty(container, 'clientHeight', { value: 900 })
    document.body.append(container)
    return { calls, blits, container }
  }

  const identity = { toViewport: ({ x, y }: { x: number; y: number }) => ({ x, y }) }
  const constellation = (communityId: number, x: number, y: number) => ({
    communityId,
    count: 10,
    x,
    y,
    spread: 40,
    isThirdParty: false,
  })

  test('sits behind the graph as the first child, and is removed on destroy', () => {
    const { container } = recordingCanvas()
    container.append(document.createElement('canvas'))
    const layer = createUniverseLayer(container)

    expect(container.firstElementChild?.className).toBe('eog-universe')
    layer.destroy()
    expect(container.querySelector('.eog-universe')).toBeNull()
  })

  test('draws again only when the camera or the state change: nothing at rest', () => {
    const { calls, container } = recordingCanvas()
    const layer = createUniverseLayer(container)
    const state = { constellations: [constellation(1, 700, 400)], rings: [], highlightedCommunity: null }
    const camera = { x: 0.5, y: 0.5, ratio: 1 }

    layer.draw({ ...identity, camera }, state)
    const afterFirst = { ...calls }
    layer.draw({ ...identity, camera: { ...camera } }, state)
    expect(calls).toEqual(afterFirst)

    layer.draw({ ...identity, camera: { ...camera, x: 0.6 } }, state)
    expect(calls.clearRect).toBe(afterFirst.clearRect + 1)
  })

  test('one nebula per visible constellation, at most MAX_NEBULAE, none off screen', () => {
    const { blits, container } = recordingCanvas()
    const layer = createUniverseLayer(container)
    const many = Array.from({ length: MAX_NEBULAE + 10 }, (_v, i) => constellation(i, 100 + (i % 20) * 60, 450))
    const offScreen = constellation(999, 99_999, 450)

    layer.draw({ ...identity, camera: { x: 0.5, y: 0.5, ratio: 1 } }, { constellations: [offScreen, ...many], rings: [], highlightedCommunity: null })

    expect(blits.filter(([, , w]) => w !== STAR_TILE)).toHaveLength(MAX_NEBULAE - 1)
  })

  test('stars drift with the camera, but much less than the graph (parallax), as a few tile blits', () => {
    const { blits, container } = recordingCanvas()
    const layer = createUniverseLayer(container)
    const empty = { constellations: [], rings: [], highlightedCommunity: null }
    const firstTile = () => blits.filter(([, , w]) => w === STAR_TILE)

    layer.draw({ ...identity, camera: { x: 0.5, y: 0.5, ratio: 1 } }, empty)
    const before = firstTile()
    blits.length = 0
    layer.draw({ ...identity, camera: { x: 0.51, y: 0.5, ratio: 1 } }, empty)
    const after = firstTile()

    // Two layers of 512 px tiles over 1440 × 900: a dozen blits each, not a thousand points.
    expect(before.length).toBeLessThanOrEqual(2 * 4 * 3)
    // The graph moves 0.01 × 900 = 9 px; the stars at most 8 % of that.
    const moved = Math.abs(after[0]![0]! - before[0]![0]!)
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(1)
  })

  const eye = { x: 720, y: 450, radius: 300 }
  const camera = { x: 0.5, y: 0.5, ratio: 1 }

  test('the eye is drawn around the graph from afar, and its lid and rings fade as the camera closes in', () => {
    expect(eyePresence(1)).toBe(1)
    expect(eyePresence(0.5)).toBeGreaterThan(0)
    expect(eyePresence(0.5)).toBeLessThan(1)
    expect(eyePresence(0.1)).toBe(0)
  })

  test('the pupil stays lit at the centre of the eye at any distance', () => {
    const { container } = recordingCanvas()
    const layer = createUniverseLayer(container)
    const context = (HTMLCanvasElement.prototype.getContext as unknown as () => { fillRect: ReturnType<typeof vi.fn> })()

    layer.draw({ ...identity, camera: { ...camera, ratio: 0.05 }, eye }, { constellations: [], rings: [0.3, 0.6, 0.85], highlightedCommunity: null })

    const [x, y, w] = context.fillRect.mock.calls.at(-1) as number[]
    expect(x! + w! / 2).toBeCloseTo(720)
    expect(y! + w! / 2).toBeCloseTo(450)
  })
})

describe('iris rings', () => {
  test('quarter, half and three-quarter distances of the drawn nodes, as fractions of the iris', () => {
    const graph: KnowledgeGraph = new Graph()
    // 8 nodes on a circle of radius 10 and 4 at the centre: bounding box half-size 10.
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      graph.addNode(`r${i}`, { label: '', x: 10 * Math.cos(angle), y: 10 * Math.sin(angle), size: 1, community: 1, isThirdParty: false })
    }
    for (let i = 0; i < 4; i++) graph.addNode(`c${i}`, { label: '', x: 0, y: 0, size: 1, community: 2, isThirdParty: false })

    const rings = irisRings(graph, () => true)

    expect(rings).toHaveLength(3)
    expect(rings[0]).toBeCloseTo(0)
    expect(rings[2]).toBeCloseTo(1)
    expect(irisRings(graph, () => false)).toEqual([])
  })
})
