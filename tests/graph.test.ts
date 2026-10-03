import { describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import {
  applyPositions,
  buildGraph,
  buildGraphIndex,
  computeVisibleNodeIds,
  DEFAULT_FILTERS,
  findShortestPath,
  getConnectedComponents,
  getNeighbors,
  seedPositions,
  toPositionMap,
} from '@/graph'
import { makeRawGraph } from './fixtures'

function setup() {
  const model = adaptGraphify(makeRawGraph())
  const positions = toPositionMap(model.nodes, seedPositions(model.nodes))
  const graph = buildGraph(model)
  applyPositions(graph, positions)
  return { model, graph, positions }
}

describe('buildGraph', () => {
  test('creates one graphology node and edge per model element', () => {
    const { graph } = setup()

    expect(graph.order).toBe(6)
    expect(graph.size).toBe(4)
    expect(graph.source('app_index|contains|app_index_main')).toBe('app_index')
  })

  test('gives every node finite coordinates and a size for Sigma', () => {
    const { graph } = setup()

    graph.forEachNode((_id, attributes) => {
      expect(Number.isFinite(attributes.x)).toBe(true)
      expect(Number.isFinite(attributes.y)).toBe(true)
      expect(attributes.size).toBeGreaterThan(0)
    })
  })

  test('keeps third-party nodes in the base graph, flagged', () => {
    const { graph } = setup()

    expect(graph.getNodeAttribute('app_lib_xlsx_min_s', 'isThirdParty')).toBe(true)
    expect(graph.getNodeAttribute('app_index', 'isThirdParty')).toBe(false)
  })

  test('applyPositions ignores ids that are not in the graph', () => {
    const { graph } = setup()

    applyPositions(graph, new Map([['ghost', { x: 1, y: 1 }], ['os', { x: 7, y: 9 }]]))

    expect(graph.hasNode('ghost')).toBe(false)
    expect(graph.getNodeAttributes('os')).toMatchObject({ x: 7, y: 9 })
  })

  test('accepts parallel edges between the same pair of nodes', () => {
    const raw = makeRawGraph()
    const model = adaptGraphify({ ...raw, links: [...raw.links, raw.links[0]] })

    expect(buildGraph(model).size).toBe(5)
  })
})

describe('buildGraphIndex', () => {
  test('looks up nodes by id and members by community', () => {
    const index = buildGraphIndex(setup().model)

    expect(index.nodeById.get('os')?.isExternal).toBe(true)
    expect(index.nodeIdsByCommunity.get(0)).toEqual(['app_index', 'app_index_main', 'os'])
  })
})

describe('seedPositions', () => {
  test('is deterministic and never stacks two nodes', () => {
    const { model } = setup()

    const first = seedPositions(model.nodes)
    const second = seedPositions(model.nodes)

    expect([...first]).toEqual([...second])
    const points = new Set(model.nodes.map((_node, i) => `${first[i * 2]},${first[i * 2 + 1]}`))
    expect(points.size).toBe(model.nodes.length)
  })
})

describe('graph queries', () => {
  test('splits neighbours by direction and skips self-loops', () => {
    const { graph } = setup()

    expect(getNeighbors(graph, 'app_index_main')).toEqual({
      incoming: ['app_index'],
      outgoing: ['app_lib_xlsx_min_s', 'os'],
    })
  })

  test('finds the shortest path ignoring direction by default', () => {
    const { graph } = setup()

    expect(findShortestPath(graph, 'os', 'app_index')).toEqual(['os', 'app_index_main', 'app_index'])
    expect(findShortestPath(graph, 'os', 'app_index', { directed: true })).toBeNull()
  })

  test('returns null when no path exists or a node is filtered out', () => {
    const { graph } = setup()

    expect(findShortestPath(graph, 'app_index', 'lonely')).toBeNull()
    expect(findShortestPath(graph, 'app_index', 'missing')).toBeNull()
    expect(
      findShortestPath(graph, 'app_index', 'os', { allowedNodeIds: new Set(['app_index', 'os']) }),
    ).toBeNull()
  })

  test('lists connected components, largest first', () => {
    const { graph } = setup()

    expect(getConnectedComponents(graph).map((component) => component.length)).toEqual([4, 1, 1])
  })
})

describe('computeVisibleNodeIds', () => {
  test('hides third-party nodes by default', () => {
    const visible = computeVisibleNodeIds(setup().model, DEFAULT_FILTERS)

    expect(visible.has('app_lib_xlsx_min_s')).toBe(false)
    expect(visible.size).toBe(5)
  })

  test('applies isolated, community and kind filters together', () => {
    const visible = computeVisibleNodeIds(setup().model, {
      ...DEFAULT_FILTERS,
      hideIsolated: true,
      hiddenCommunities: [1],
      kinds: ['code'],
    })

    expect([...visible]).toEqual(['app_index', 'app_index_main'])
  })
})
