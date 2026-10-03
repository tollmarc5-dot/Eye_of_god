import { describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import { buildGraph, computeVisibleNodeIds, DEFAULT_FILTERS } from '@/graph'
import { computeFocus, createReducers, EMPTY_VIEW_STATE, type RendererViewState } from '@/renderer/reducers'
import { communityColor, communityEdgeColor, mutedCommunityColor } from '@/utils/color'
import { makeRawGraph } from './fixtures'

const CONTAINS_EDGE = 'app_index|contains|app_index_main'
const IMPORTS_EDGE = 'app_index_main|imports|os'

function setup(view: Partial<RendererViewState> = {}, hoveredNodeId: string | null = null) {
  const model = adaptGraphify(makeRawGraph())
  const graph = buildGraph(model)
  const state: RendererViewState = { ...EMPTY_VIEW_STATE, ...view }
  const focus = computeFocus(graph, state, hoveredNodeId)
  const reducers = createReducers(graph, () => state, () => focus)
  return {
    model,
    graph,
    focus,
    // Sigma passes each reducer a copy of the attributes; so do these helpers.
    node: (id: string) => reducers.nodeReducer(id, { ...graph.getNodeAttributes(id) }),
    edge: (id: string) => reducers.edgeReducer(id, { ...graph.getEdgeAttributes(id) }),
  }
}

describe('third-party filter', () => {
  test('hides third-party nodes and their edges without touching the graph', () => {
    const model = adaptGraphify(makeRawGraph())
    const { graph, node, edge } = setup({
      visibleNodeIds: computeVisibleNodeIds(model, DEFAULT_FILTERS),
    })

    expect(node('app_lib_xlsx_min_s').hidden).toBe(true)
    expect(edge('app_index_main|calls|app_lib_xlsx_min_s').hidden).toBe(true)
    expect(node('app_index').hidden).toBeUndefined()
    expect(graph.hasNode('app_lib_xlsx_min_s')).toBe(true)
    expect(graph.order).toBe(6)
  })

  test('shows them again, in a muted colour, once the filter is off', () => {
    const model = adaptGraphify(makeRawGraph())
    const { node } = setup({
      visibleNodeIds: computeVisibleNodeIds(model, { ...DEFAULT_FILTERS, hideThirdParty: false }),
    })

    expect(node('app_lib_xlsx_min_s')).toMatchObject({ color: mutedCommunityColor(1) })
    expect(node('app_lib_xlsx_min_s').hidden).toBeUndefined()
    expect(node('app_index').color).toBe(communityColor(0))
  })
})

describe('selection', () => {
  test('highlights the selected node, keeps its neighbours and dims the rest', () => {
    const { node } = setup({ selectedNodeId: 'app_index' })

    expect(node('app_index')).toMatchObject({ highlighted: true, forceLabel: true })
    expect(node('app_index_main').color).toBe(communityColor(0))
    expect(node('os')).toMatchObject({ label: null })
    expect(node('os').color).not.toBe(communityColor(0))
  })

  test('emphasises only the edges that touch the selected node', () => {
    const { edge } = setup({ selectedNodeId: 'app_index' })

    expect(edge(CONTAINS_EDGE).size).toBeGreaterThan(1)
    expect(edge(IMPORTS_EDGE).color).not.toBe(edge(CONTAINS_EDGE).color)
  })

  test('with no selection nothing is dimmed or highlighted', () => {
    const { node, focus } = setup()

    expect(focus.activeNodeId).toBeNull()
    expect(node('os')).toMatchObject({ color: communityColor(0), label: 'os' })
    expect(node('os').highlighted).toBeUndefined()
  })

  test('a selected node that is filtered out does not dim the graph', () => {
    const { focus } = setup({ selectedNodeId: 'os', visibleNodeIds: new Set(['app_index']) })

    expect(focus.activeNodeId).toBeNull()
  })
})

describe('hover', () => {
  test('wins over the selection and exposes the hovered node neighbours', () => {
    const { focus } = setup({ selectedNodeId: 'lonely' }, 'app_index_main')

    expect(focus.activeNodeId).toBe('app_index_main')
    expect([...focus.neighborIds].sort()).toEqual(
      ['app_index', 'app_index_main', 'app_lib_xlsx_min_s', 'os'].sort(),
    )
  })
})

describe('edge visibility', () => {
  test('hides every edge when edges are switched off', () => {
    expect(setup({ showEdges: false }).edge(CONTAINS_EDGE).hidden).toBe(true)
  })

  test('hides relations that are not in the allowed set', () => {
    const { edge } = setup({ visibleRelations: new Set(['contains']) })

    expect(edge(CONTAINS_EDGE).hidden).toBeUndefined()
    expect(edge(IMPORTS_EDGE).hidden).toBe(true)
  })
})

describe('community constellations', () => {
  test('tints edges inside a community and keeps cross-community edges neutral', () => {
    const raw = makeRawGraph()
    const crossLink = { ...raw.links[0], source: 'app_index', target: 'docs_readme', relation: 'references' }
    const model = adaptGraphify({ ...raw, links: [...raw.links, crossLink] })
    const graph = buildGraph(model)
    const reducers = createReducers(graph, () => EMPTY_VIEW_STATE, () => computeFocus(graph, EMPTY_VIEW_STATE, null))
    const colorOf = (id: string) => reducers.edgeReducer(id, { ...graph.getEdgeAttributes(id) }).color

    expect(colorOf(CONTAINS_EDGE)).toBe(communityEdgeColor(0))
    expect(colorOf('app_index|references|docs_readme')).not.toBe(communityEdgeColor(0))
  })
})

describe('community colours', () => {
  test('are deterministic and distinct for 169 communities', () => {
    const colors = Array.from({ length: 169 }, (_value, id) => communityColor(id))

    expect(new Set(colors).size).toBe(169)
    expect(communityColor(42)).toBe(colors[42])
    expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
  })
})
