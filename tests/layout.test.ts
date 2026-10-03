import { describe, expect, test } from 'vitest'
import {
  planLayout,
  POSITION_CACHE_KEY,
  readPositionCache,
  runForceLayout,
  seedPositions,
  toPositionMap,
  writePositionCache,
  type LayoutNode,
  type PositionStorage,
} from '@/graph'
import type { Position } from '@/types/graph'

const NODES: readonly LayoutNode[] = [
  { id: 'a', community: 0 },
  { id: 'b', community: 0 },
  { id: 'c', community: 1 },
  { id: 'd', community: 1 },
  { id: 'e', community: null },
]
const EDGES = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'c', target: 'd' },
  { source: 'a', target: 'a' },
  { source: 'a', target: 'ghost' },
]

function layout(nodes: readonly LayoutNode[], cached = new Map<string, Position>()) {
  const plan = planLayout(nodes, EDGES, cached)
  return toPositionMap(nodes, runForceLayout(plan.request), cached)
}

function memoryStorage(initial: Record<string, string> = {}): PositionStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('seedPositions', () => {
  test('keeps new nodes outside the given radius', () => {
    const seeds = seedPositions(NODES, 500)

    const distances = NODES.map((_node, i) => Math.hypot(seeds[i * 2] ?? 0, seeds[i * 2 + 1] ?? 0))
    expect(Math.min(...distances)).toBeGreaterThan(400)
  })
})

describe('planLayout (worker protocol)', () => {
  test('describes the graph with index-based typed arrays only', () => {
    const { request, freeCount } = planLayout(NODES, EDGES, new Map())

    expect(request.positions).toBeInstanceOf(Float32Array)
    expect(request.positions).toHaveLength(NODES.length * 2)
    expect(request.fixed).toBeInstanceOf(Uint8Array)
    expect([...request.fixed]).toEqual([0, 0, 0, 0, 0])
    // Self-loops and edges to nodes outside the scope are dropped.
    expect([...request.edges]).toEqual([0, 1, 1, 2, 2, 3])
    expect(request.iterations).toBeGreaterThan(0)
    expect(freeCount).toBe(5)
  })

  test('pins cached nodes and frees only the new ones', () => {
    const cached = new Map([
      ['a', { x: 10, y: 20 }],
      ['removed-node', { x: 99, y: 99 }],
    ])

    const { request, freeCount } = planLayout(NODES, EDGES, cached)

    expect([...request.fixed]).toEqual([1, 0, 0, 0, 0])
    expect([request.positions[0], request.positions[1]]).toEqual([10, 20])
    expect(freeCount).toBe(4)
  })

  test('asks for no iterations when every node is cached', () => {
    const cached = new Map(NODES.map((node, i) => [node.id, { x: i, y: -i }]))

    const { request, freeCount } = planLayout(NODES, EDGES, cached)

    expect(freeCount).toBe(0)
    expect(request.iterations).toBe(0)
  })
})

describe('runForceLayout', () => {
  test('returns one finite position per node', () => {
    const positions = layout(NODES)

    expect(positions.size).toBe(NODES.length)
    for (const { x, y } of positions.values()) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
    }
  })

  test('is deterministic: same input, same positions', () => {
    expect([...layout(NODES)]).toEqual([...layout(NODES)])
  })

  test('never moves a pinned node', () => {
    const { request } = planLayout(NODES, EDGES, new Map([['b', { x: 42, y: -7 }]]))

    const result = runForceLayout(request)

    expect([result[2], result[3]]).toEqual([42, -7])
  })

  test('rejects a malformed request', () => {
    const { request } = planLayout(NODES, EDGES, new Map())

    expect(() => runForceLayout({ ...request, positions: new Float32Array(3) })).toThrow(/mismatch/)
    expect(() => runForceLayout({ ...request, edges: Uint32Array.from([0, 99]) })).toThrow(/outside/)
  })
})

describe('position cache by node id', () => {
  test('second run reuses every cached position untouched', () => {
    const first = layout(NODES)

    const second = layout(NODES, new Map(first))

    expect([...second]).toEqual([...first])
  })

  test('identity is the id, not the array index', () => {
    const first = layout(NODES)
    const reordered = [...NODES].reverse()

    const second = layout(reordered, new Map(first))

    for (const node of NODES) expect(second.get(node.id)).toBe(first.get(node.id))
  })

  test('a new node gets a position while existing ones stay put', () => {
    const first = layout(NODES)
    const grown = [...NODES, { id: 'new', community: 0 }]

    const second = layout(grown, new Map(first))

    for (const node of NODES) expect(second.get(node.id)).toBe(first.get(node.id))
    expect(second.get('new')).toBeDefined()
    expect(first.has('new')).toBe(false)
  })

  test('a removed node is simply ignored', () => {
    const first = layout(NODES)
    const shrunk = NODES.filter((node) => node.id !== 'c')

    const second = layout(shrunk, new Map(first))

    expect(second.has('c')).toBe(false)
    expect(second.size).toBe(4)
  })
})

describe('position cache storage', () => {
  test('round-trips positions and drops ids that no longer exist', () => {
    const storage = memoryStorage()
    writePositionCache(storage, new Map([['a', { x: 1.234, y: -5 }], ['gone', { x: 0, y: 0 }]]))

    const restored = readPositionCache(storage, new Set(['a', 'b']))

    expect([...restored]).toEqual([['a', { x: 1.23, y: -5 }]])
  })

  test.each([
    ['missing', {}],
    ['not JSON', { [POSITION_CACHE_KEY]: '{oops' }],
    ['wrong shape', { [POSITION_CACHE_KEY]: '[1,2,3]' }],
  ])('returns an empty cache when the stored value is %s', (_name, initial) => {
    expect(readPositionCache(memoryStorage(initial), new Set(['a'])).size).toBe(0)
  })

  test('skips entries that are not a pair of finite numbers', () => {
    const storage = memoryStorage({
      [POSITION_CACHE_KEY]: JSON.stringify({ a: [1, 2], b: ['x', 2], c: [1], d: [null, 0] }),
    })

    expect([...readPositionCache(storage, new Set(['a', 'b', 'c', 'd'])).keys()]).toEqual(['a'])
  })

  test('reports failure instead of throwing when storage is full', () => {
    const storage: PositionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }

    expect(writePositionCache(storage, new Map([['a', { x: 0, y: 0 }]]))).toBe(false)
  })
})
