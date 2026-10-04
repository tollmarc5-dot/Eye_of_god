// @vitest-environment jsdom
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { ExplorerPanel } from '@/features/explorer/ExplorerPanel'
import { GraphControls } from '@/features/hud/GraphControls'
import { useNavigationKeys } from '@/features/hud/navigation-keys'
import { NavigationStatus } from '@/features/hud/NavigationStatus'
import { InspectorPanel } from '@/features/inspector/InspectorPanel'
import { GraphCommandsContext, type GraphCommands } from '@/features/world/graph-commands'
import { GraphWorld } from '@/features/world/GraphWorld'
import {
  aggregateSize,
  applyPositions,
  buildGraph,
  buildGraphIndex,
  computeAggregates,
  computeVisibleNodeIds,
  DEFAULT_FILTERS,
  describeCommunity,
  isCommunityCollapsed,
  NO_AGGREGATION,
  summarizeCommunities,
  withCommunityCollapsed,
  type Aggregation,
} from '@/graph'
import type { GraphRenderer, RendererEvents, RendererViewState } from '@/renderer'
import { COLLAPSED_MEMBER_SIZE, computeFocus, createReducers, EMPTY_VIEW_STATE } from '@/renderer/reducers'
import { buildSearchIndex } from '@/search'
import { useAppStore } from '@/state/store'
import { DEFAULT_VIEW_STATE } from '@/state/url-state'
import { CANVAS_THEME } from '@/styles/canvas-theme'

const fake = vi.hoisted(() => ({
  events: {} as RendererEvents,
  views: [] as RendererViewState[],
  focusNode: vi.fn((_nodeId: string) => true),
  frameNodes: vi.fn((_nodeIds: Iterable<string>) => true),
  resetCamera: vi.fn(),
}))

// The real module pulls in Sigma, which needs WebGL just to be imported.
vi.mock('@/renderer', () => ({
  createSigmaRenderer: (_container: HTMLElement, _graph: unknown, events: RendererEvents): GraphRenderer => {
    fake.events = events
    return {
      setViewState: (view) => void fake.views.push(view),
      setOccludedRects: vi.fn(),
      setOcclusionSource: vi.fn(),
      focusNode: fake.focusNode,
      frameNeighborhood: vi.fn(() => true),
      frameNodes: fake.frameNodes,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetCamera: fake.resetCamera,
      getCamera: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }),
      setCamera: vi.fn(),
      getNodeViewportPosition: () => null,
      getMotionQuality: () => 'still',
      destroy: vi.fn(),
    }
  },
}))

/**
 * Community 0 "Core API":  a → b → c         (app/src)
 * Community 1:             d → e             (app/tools)
 * Community 5 (vendor):    t1 → t2           third-party; ids are not consecutive
 * Community 9:             z                 isolated, another project
 * Between communities only through third-party code, as in the real graph:
 * c → t1 and t2 → d.
 */
function makeCommunityGraph() {
  const node = (id: string, community: number, file: string, name?: string) => ({
    id,
    label: id.toUpperCase(),
    norm_label: id,
    community,
    ...(name ? { community_name: name } : {}),
    file_type: 'code',
    source_file: file,
    source_location: 'L1',
    _origin: 'ast',
  })
  const link = (source: string, target: string) => ({
    source,
    target,
    relation: 'calls',
    confidence: 'EXTRACTED',
    confidence_score: 1,
    weight: 1,
    source_file: 'app/src/a.js',
    source_location: 'L1',
  })
  return {
    directed: false,
    multigraph: false,
    graph: {},
    nodes: [
      node('a', 0, 'app/src/a.js', 'Core API'),
      node('b', 0, 'app/src/b.js', 'Core API'),
      node('c', 0, 'app/lib/c.js', 'Core API'),
      node('d', 1, 'app/tools/d.js'),
      node('e', 1, 'app/tools/e.js'),
      node('t1', 5, 'app/public/lib/vendor.min.js'),
      node('t2', 5, 'app/public/lib/vendor.min.js'),
      node('z', 9, 'docs/z.md'),
    ],
    links: [link('a', 'b'), link('b', 'c'), link('d', 'e'), link('c', 't1'), link('t1', 't2'), link('t2', 'd')],
    hyperedges: [],
  }
}

const model = adaptGraphify(makeCommunityGraph())
const index = buildGraphIndex(model)
const graph = buildGraph(model)
const coordinates: Record<string, [number, number]> = {
  a: [0, 0],
  b: [10, 0],
  c: [20, 30],
  d: [100, 100],
  e: [120, 100],
  t1: [50, 50],
  t2: [60, 70],
  z: [200, 0],
}
const positions = new Map(model.nodes.map((node) => [node.id, { x: coordinates[node.id]?.[0] ?? 0, y: coordinates[node.id]?.[1] ?? 0 }]))
applyPositions(graph, positions)
const firstParty = computeVisibleNodeIds(model, DEFAULT_FILTERS)
const everything = computeVisibleNodeIds(model, { ...DEFAULT_FILTERS, hideThirdParty: false })
const COMMUNITY_MODE: Aggregation = { mode: 'communities', exceptions: [] }
const initialState = useAppStore.getState()
const store = () => useAppStore.getState()
const sorted = (ids: Iterable<string | number>) => [...ids].sort()

function resetStore() {
  useAppStore.setState(
    {
      ...initialState,
      filters: DEFAULT_FILTERS,
      data: { status: 'ready', model, index, search: buildSearchIndex(model), graph, positions },
    },
    true,
  )
}

describe('community model', () => {
  test('communities keep their real ids and names, consecutive or not', () => {
    expect(model.communities.map((community) => [community.id, community.name])).toEqual([
      [0, 'Core API'],
      [1, 'Community 1'],
      [5, 'Community 5'],
      [9, 'Community 9'],
    ])
    expect(sorted(index.nodeIdsByCommunity.get(5) ?? [])).toEqual(['t1', 't2'])
  })

  test('summaries separate what exists from what is drawn', () => {
    const hidden = summarizeCommunities(model, index, firstParty)
    const shown = summarizeCommunities(model, index, everything)

    expect(model.communities.find((community) => community.id === 5)?.size).toBe(2)
    expect(hidden.get(5)).toMatchObject({ visibleCount: 0, internalEdgeCount: 0, externalEdgeCount: 0 })
    expect(shown.get(5)).toMatchObject({ visibleCount: 2, internalEdgeCount: 1, externalEdgeCount: 2 })
    expect(hidden.get(0)).toMatchObject({ visibleCount: 3, internalEdgeCount: 2, externalEdgeCount: 0 })
    expect(shown.get(0)).toMatchObject({ visibleCount: 3, internalEdgeCount: 2, externalEdgeCount: 1 })
  })

  test('relations between communities are counted once per relation, from both sides', () => {
    const shown = summarizeCommunities(model, index, everything)

    expect([...(shown.get(5)?.neighbors ?? [])].sort()).toEqual([[0, 1], [1, 1]])
    expect([...(shown.get(0)?.neighbors ?? [])]).toEqual([[5, 1]])
    expect(shown.get(9)?.neighbors.size).toBe(0)
  })

  test('details list members, projects, folders, key nodes and connected communities', () => {
    const details = describeCommunity(model, index, summarizeCommunities(model, index, everything), 0, everything, 2)

    expect(sorted(details?.nodeIds ?? [])).toEqual(['a', 'b', 'c'])
    expect(details?.projects).toEqual([{ name: 'app', count: 3 }])
    expect(details?.folders).toEqual([
      { name: 'app/src', count: 2 },
      { name: 'app/lib', count: 1 },
    ])
    // b and c have degree 2; the id breaks the tie.
    expect(details?.keyNodes.map((node) => node.id)).toEqual(['b', 'c'])
    expect(details?.connected.map((entry) => [entry.community.id, entry.count])).toEqual([[5, 1]])
  })

  test('details follow the filters: hidden members are neither counted nor listed', () => {
    const details = describeCommunity(model, index, summarizeCommunities(model, index, firstParty), 5, firstParty, 5)

    expect(details?.community.size).toBe(2)
    expect(details?.summary.visibleCount).toBe(0)
    expect(details?.keyNodes).toEqual([])
    expect(details?.projects).toEqual([])
  })

  test('a community that does not exist has no details', () => {
    expect(describeCommunity(model, index, summarizeCommunities(model, index, everything), 3, everything, 5)).toBeNull()
  })
})

describe('aggregation', () => {
  test('node view collapses only the exceptions; community view expands only them', () => {
    expect(isCommunityCollapsed(NO_AGGREGATION, 0)).toBe(false)
    expect(isCommunityCollapsed({ mode: 'nodes', exceptions: [5] }, 5)).toBe(true)
    expect(isCommunityCollapsed(COMMUNITY_MODE, 5)).toBe(true)
    expect(isCommunityCollapsed({ mode: 'communities', exceptions: [5] }, 5)).toBe(false)
  })

  test('collapsing and expanding are idempotent and never mutate', () => {
    const collapsed = withCommunityCollapsed(NO_AGGREGATION, 9, true)

    expect(collapsed).toEqual({ mode: 'nodes', exceptions: [9] })
    expect(withCommunityCollapsed(collapsed, 9, true)).toBe(collapsed)
    expect(withCommunityCollapsed(collapsed, 9, false)).toEqual(NO_AGGREGATION)
    expect(NO_AGGREGATION.exceptions).toEqual([])
    expect(withCommunityCollapsed(COMMUNITY_MODE, 0, false)).toEqual({ mode: 'communities', exceptions: [0] })
  })

  test('nothing is aggregated in the plain node view', () => {
    expect(computeAggregates(graph, model, index, NO_AGGREGATION, everything).size).toBe(0)
  })

  test('an aggregate is led by its best connected drawn member, and sits where that node is', () => {
    const aggregates = computeAggregates(graph, model, index, COMMUNITY_MODE, everything)

    expect(aggregates.get(0)).toMatchObject({
      communityId: 0,
      representativeId: 'b',
      x: 10,
      y: 0,
      memberCount: 3,
      label: 'Core API · 3',
      size: aggregateSize(3),
    })
    expect(sorted(aggregates.keys())).toEqual([0, 1, 5, 9])
  })

  test('only drawn members count: a fully hidden community has no aggregate', () => {
    const aggregates = computeAggregates(graph, model, index, COMMUNITY_MODE, firstParty)

    expect(aggregates.has(5)).toBe(false)
    expect(sorted(aggregates.keys())).toEqual([0, 1, 9])
  })

  test('is deterministic, and grows with the number of members', () => {
    const first = computeAggregates(graph, model, index, COMMUNITY_MODE, everything)

    expect([...computeAggregates(graph, model, index, COMMUNITY_MODE, everything)]).toEqual([...first])
    expect(aggregateSize(1)).toBeLessThan(aggregateSize(10))
    expect(aggregateSize(10)).toBeLessThan(aggregateSize(60))
    expect(aggregateSize(5000)).toBe(aggregateSize(50000))
  })

  test('communities holding a node of a shown path or expansion stay expanded', () => {
    const aggregates = computeAggregates(graph, model, index, COMMUNITY_MODE, everything, {
      keepExpandedFor: new Set(['c', 't1']),
    })

    expect(sorted(aggregates.keys())).toEqual([1, 9])
  })

  test('aggregating adds nothing to the graph', () => {
    computeAggregates(graph, model, index, COMMUNITY_MODE, everything)

    expect(graph.order).toBe(8)
    expect(graph.size).toBe(6)
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 0, y: 0 })
  })
})

describe('aggregates in the renderer', () => {
  function reduce(view: Partial<RendererViewState>, hoveredNodeId: string | null = null) {
    const state: RendererViewState = {
      ...EMPTY_VIEW_STATE,
      aggregates: computeAggregates(graph, model, index, COMMUNITY_MODE, everything),
      ...view,
    }
    const focus = computeFocus(graph, state, hoveredNodeId)
    const reducers = createReducers(graph, () => state, () => focus)
    return {
      node: (id: string) => reducers.nodeReducer(id, { ...graph.getNodeAttributes(id) }) as Record<string, unknown>,
      edge: (id: string) => reducers.edgeReducer(id, { ...graph.getEdgeAttributes(id) }) as Record<string, unknown>,
    }
  }

  test('the representative becomes the aggregate; the other members shrink and anchor to it', () => {
    const { node } = reduce({})

    expect(node('b')).toMatchObject({ x: 10, y: 0, aggregate: 1, label: 'Core API · 3', size: aggregateSize(3) })
    expect(node('b').anchor).toBeUndefined()
    // No node is moved: the edge program draws the relations of `a` on `b`.
    expect(node('a')).toMatchObject({ x: 0, y: 0, size: COLLAPSED_MEMBER_SIZE, label: null, anchor: 'b' })
    // Not hidden: Sigma would drop the relations that leave the community.
    expect(node('a').hidden).toBeUndefined()
  })

  test('relations inside an aggregate are not drawn; those that leave it are', () => {
    const { edge } = reduce({})

    expect(edge('a|calls|b').hidden).toBe(true)
    expect(edge('c|calls|t1').hidden).toBeUndefined()
    expect(edge('c|calls|t1').color).toBe(CANVAS_THEME.edge)
  })

  test('an expanded community is drawn node by node, next to collapsed ones', () => {
    const aggregates = computeAggregates(graph, model, index, { mode: 'communities', exceptions: [0] }, everything)
    const { node, edge } = reduce({ aggregates })

    expect(node('a')).toMatchObject({ x: 0, y: 0 })
    expect(node('a').aggregate).toBeUndefined()
    expect(edge('a|calls|b').hidden).toBeUndefined()
    expect(node('t1').aggregate).toBe(1)
  })

  test('the selected community carries the selection ring and lights its relations', () => {
    const { node, edge } = reduce({ selectedCommunityId: 5 })

    expect(node('t1')).toMatchObject({ accent: 1, highlighted: true, forceLabel: true })
    expect(node('b').accent).toBeUndefined()
    expect(edge('c|calls|t1').color).toBe(CANVAS_THEME.edgeFocus)
    expect(edge('d|calls|e').hidden).toBe(true)
  })

  test('hovering an aggregate answers on it and dims nothing else', () => {
    const { node } = reduce({}, 'b')

    expect(node('b')).toMatchObject({ highlighted: true, glow: 1 })
    expect(node('d').color).not.toBe(CANVAS_THEME.nodeDimmed)
  })

  test('with a node selected, the aggregates that hold its neighbours stay lit', () => {
    const aggregates = computeAggregates(graph, model, index, { mode: 'communities', exceptions: [0] }, everything)
    const { node } = reduce({ aggregates, selectedNodeId: 'c' })

    expect(node('t1').color).not.toBe(CANVAS_THEME.nodeDimmed)
    expect(node('d').color).toBe(CANVAS_THEME.nodeDimmed)
  })
})

describe('community state (store)', () => {
  beforeEach(resetStore)

  test('selecting a community deselects the node, opens the inspector and records no history', () => {
    store().selectNode('a')
    store().setPanel('inspector', false)

    store().selectCommunity(1)

    expect(store()).toMatchObject({ selectedCommunityId: 1, selectedNodeId: null, history: ['a'], historyIndex: 0 })
    expect(store().panels.inspector).toBe(true)
  })

  test('selecting a node leaves the community selection', () => {
    store().selectCommunity(1)

    store().selectNode('d')

    expect(store()).toMatchObject({ selectedCommunityId: null, selectedNodeId: 'd' })
  })

  test('selecting a node inside a collapsed community expands that community only', () => {
    store().setCommunityMode(true)

    store().revealNode('d')

    expect(isCommunityCollapsed(store().aggregation, 1)).toBe(false)
    expect(isCommunityCollapsed(store().aggregation, 0)).toBe(true)
    expect(store().selectedNodeId).toBe('d')
  })

  test('collapsing the community of the selected node moves the selection to the community', () => {
    store().selectNode('a')

    store().setCommunityCollapsed(0, true)

    expect(store()).toMatchObject({ selectedNodeId: null, selectedCommunityId: 0 })
    expect(store().history).toEqual(['a'])
  })

  test('collapsing another community keeps the selected node', () => {
    store().selectNode('a')

    store().setCommunityCollapsed(1, true)

    expect(store()).toMatchObject({ selectedNodeId: 'a', selectedCommunityId: null })
  })

  test('collapsing ends a shown path and an expansion; expanding ends nothing', () => {
    store().selectNode('a')
    store().startPath()
    store().selectNode('c')
    store().setExpansion('c', 2)
    store().setCommunityCollapsed(9, true)
    expect(store()).toMatchObject({ path: { status: 'idle' }, expansion: null })

    store().setExpansion('c', 1)
    store().setCommunityCollapsed(9, false)
    expect(store().expansion).toEqual({ rootId: 'c', depth: 1 })
  })

  test('community view collapses everything and hands the selection to the community', () => {
    store().selectNode('d')

    store().setCommunityMode(true)

    expect(store().aggregation).toEqual({ mode: 'communities', exceptions: [] })
    expect(store()).toMatchObject({ selectedNodeId: null, selectedCommunityId: 1 })

    store().setCommunityMode(false)
    expect(store().aggregation).toEqual(NO_AGGREGATION)
  })

  test('back into a collapsed community expands it again', () => {
    store().selectNode('a')
    store().selectNode('d')
    store().setCommunityMode(true)

    store().goBack()

    expect(store().selectedNodeId).toBe('a')
    expect(isCommunityCollapsed(store().aggregation, 0)).toBe(false)
    expect(store().selectedCommunityId).toBeNull()
  })

  test('collapse, expand and community view record no history', () => {
    store().selectNode('a')
    store().setCommunityCollapsed(1, true)
    store().setCommunityCollapsed(1, false)
    store().selectCommunity(9)
    store().setCommunityMode(true)
    store().setCommunityMode(false)

    expect(store()).toMatchObject({ history: ['a'], historyIndex: 0 })
  })

  test('while picking a path, selecting a community is not a destination', () => {
    store().selectNode('a')
    store().startPath()

    store().selectCommunity(1)

    expect(store().path).toEqual({ status: 'picking', fromId: 'a' })
  })
})

describe('communities in the interface', () => {
  let commands: GraphCommands

  function App() {
    const rendererRef = useRef<GraphRenderer | null>(null)
    useNavigationKeys()
    return (
      <GraphCommandsContext.Provider value={commands}>
        <GraphWorld model={model} index={index} graph={graph} positions={positions} rendererRef={rendererRef} />
        <ExplorerPanel model={model} index={index} />
        <InspectorPanel model={model} index={index} graph={graph} />
        <GraphControls />
        <NavigationStatus model={model} index={index} graph={graph} />
      </GraphCommandsContext.Provider>
    )
  }

  const explorer = () => within(screen.getByRole('region', { name: 'Explorer' }))
  const inspector = () => within(screen.getByRole('region', { name: 'Node inspector' }))
  const metric = (label: string) => inspector().getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
  const view = () => fake.views.at(-1)
  const aggregateIds = () => sorted(view()?.aggregates?.keys() ?? [])
  const click = (nodeId: string) => act(() => fake.events.onNodeClick?.(nodeId))

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    fake.views.length = 0
    fake.frameNodes.mockClear()
    fake.resetCamera.mockClear()
    commands = {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetCamera: vi.fn(),
      focusNode: vi.fn(),
      expandNode: (nodeId, depth) => store().setExpansion(nodeId, depth),
      focusCommunity: vi.fn(),
    }
    resetStore()
    render(<App />)
  })

  afterEach(cleanup)

  test('entering the community view frames every aggregate; leaving it does not move the camera', () => {
    fireEvent.click(explorer().getByRole('switch', { name: /Community view/ }))
    expect(fake.resetCamera).toHaveBeenCalledOnce()

    fireEvent.click(explorer().getByRole('switch', { name: /Community view/ }))
    expect(fake.resetCamera).toHaveBeenCalledOnce()
  })

  test('a link that restores the community view with its own camera keeps that camera', () => {
    act(() =>
      store().restoreView({
        ...DEFAULT_VIEW_STATE,
        aggregation: { mode: 'communities', exceptions: [] },
        camera: { x: 0.2, y: 0.3, ratio: 0.5 },
      }),
    )

    expect(store().aggregation.mode).toBe('communities')
    expect(fake.resetCamera).not.toHaveBeenCalled()
  })

  test('a link that restores the community view without a camera is framed', () => {
    act(() => store().restoreView({ ...DEFAULT_VIEW_STATE, aggregation: { mode: 'communities', exceptions: [] } }))

    expect(fake.resetCamera).toHaveBeenCalledOnce()
  })

  test('the explorer lists the drawn communities with their real names and counts', () => {
    expect(explorer().getByRole('button', { name: /^Core API\s*3/ })).toBeDefined()
    expect(explorer().getByRole('button', { name: /^Community 1\s*2/ })).toBeDefined()
    // Community 5 is third-party only: not listed while that code is hidden.
    expect(explorer().queryByRole('button', { name: /^Community 5/ })).toBeNull()
  })

  test('a community row selects, frames and opens the community without hiding anything', () => {
    const drawn = sorted(view()?.visibleNodeIds ?? [])

    fireEvent.click(explorer().getByRole('button', { name: /^Core API/ }))

    expect(store()).toMatchObject({ selectedCommunityId: 0, activeCommunity: null })
    expect(commands.focusCommunity).toHaveBeenCalledWith(0)
    expect(sorted(view()?.visibleNodeIds ?? [])).toEqual(drawn)
    expect(inspector().getByText('Core API', { selector: '.eog-node__name' })).toBeDefined()
    expect(explorer().getByRole('button', { name: /^Core API/ }).getAttribute('aria-current')).toBe('true')
  })

  test('an expanded selected community is lit as a set and framed', () => {
    fireEvent.click(explorer().getByRole('button', { name: /^Core API/ }))

    expect(view()?.highlight?.kind).toBe('community')
    expect(sorted(view()?.highlight?.nodeIds ?? [])).toEqual(['a', 'b', 'c'])
    expect(sorted(fake.frameNodes.mock.calls.at(-1)?.[0] ?? [])).toEqual(['a', 'b', 'c'])
  })

  test('the community inspector separates total from visible', () => {
    act(() => store().selectCommunity(5))

    expect(metric('Nodes')).toBe('2')
    expect(metric('Visible')).toBe('0')
    expect(inspector().getByText(/2 of its nodes are hidden by the current filters or scope/)).toBeDefined()
    expect(inspector().getByText('None of its nodes is drawn in the current view.')).toBeDefined()

    act(() => store().setFilters({ hideThirdParty: false }))

    expect(metric('Visible')).toBe('2')
    expect(metric('Internal')).toBe('1')
    expect(metric('External')).toBe('2')
  })

  test('collapse draws the aggregate; expand brings the nodes back where they were', () => {
    fireEvent.click(explorer().getByRole('button', { name: /^Core API/ }))
    expect(inspector().getByRole('button', { name: /^Expand:/ })).toHaveProperty('disabled', true)

    fireEvent.click(inspector().getByRole('button', { name: /^Collapse:/ }))
    expect(aggregateIds()).toEqual([0])
    expect(view()?.aggregates?.get(0)).toMatchObject({ representativeId: 'b', x: 10, y: 0 })
    expect(view()?.highlight).toBeNull()
    expect(inspector().getByText('Collapsed')).toBeDefined()

    fireEvent.click(inspector().getByRole('button', { name: /^Expand:/ }))
    expect(aggregateIds()).toEqual([])
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 0, y: 0 })
    expect(store().selectedCommunityId).toBe(0)
  })

  test('community view collapses every drawn community, and the banner leads back to the nodes', () => {
    fireEvent.click(explorer().getByRole('switch', { name: /Community view/ }))

    expect(aggregateIds()).toEqual([0, 1, 9])
    expect(screen.getByText('Every community collapsed')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Back to nodes' }))
    expect(aggregateIds()).toEqual([])
    expect(explorer().getByRole('switch', { name: /Community view/ }).getAttribute('aria-checked')).toBe('false')
  })

  test('a click on an aggregate selects its community, not the node that stands for it', () => {
    fireEvent.click(explorer().getByRole('switch', { name: /Community view/ }))

    click('b')

    expect(store()).toMatchObject({ selectedCommunityId: 0, selectedNodeId: null, history: [] })
    expect(view()?.selectedCommunityId).toBe(0)
    expect(inspector().getByText('Core API', { selector: '.eog-node__name' })).toBeDefined()
  })

  test('community → nodes: a key node enters the community and expands it', () => {
    fireEvent.click(explorer().getByRole('switch', { name: /Community view/ }))
    click('b')

    fireEvent.click(inspector().getByRole('button', { name: 'Enter the community at B' }))

    expect(store()).toMatchObject({ selectedNodeId: 'b', selectedCommunityId: null, history: ['b'] })
    expect(aggregateIds()).toEqual([1, 9])
    expect(inspector().getByText('B', { selector: '.eog-node__name' })).toBeDefined()
  })

  test('nodes → community: the node inspector opens the community it belongs to', () => {
    click('d')

    fireEvent.click(inspector().getByRole('button', { name: 'Open community Community 1' }))

    expect(store()).toMatchObject({ selectedCommunityId: 1, selectedNodeId: null })
    expect(commands.focusCommunity).toHaveBeenCalledWith(1)
    expect(metric('Nodes')).toBe('2')
  })

  test('navigating between connected communities, with third-party code drawn', () => {
    act(() => store().setFilters({ hideThirdParty: false }))
    act(() => store().selectCommunity(0))

    fireEvent.click(inspector().getByRole('button', { name: 'Go to community Community 5, 1 shared relations' }))

    expect(store().selectedCommunityId).toBe(5)
    expect(commands.focusCommunity).toHaveBeenLastCalledWith(5)
    expect(inspector().getByRole('button', { name: /^Go to community Core API/ })).toBeDefined()
    expect(inspector().getByRole('button', { name: /^Go to community Community 1/ })).toBeDefined()
  })

  test('"only this" is the filter, separate from selecting, and it is reversible', () => {
    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 1' }))

    expect(store()).toMatchObject({ activeCommunity: 1, selectedCommunityId: null })
    expect(sorted(view()?.visibleNodeIds ?? [])).toEqual(['d', 'e'])

    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 1' }))
    expect(store().activeCommunity).toBeNull()
  })

  test('focus, clear and Escape on a selected community', () => {
    fireEvent.click(explorer().getByRole('button', { name: /^Community 1/ }))

    fireEvent.click(inspector().getByRole('button', { name: 'Focus this community' }))
    expect(commands.focusCommunity).toHaveBeenLastCalledWith(1)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(store().selectedCommunityId).toBeNull()
    expect(inspector().getByText('No node selected')).toBeDefined()

    fireEvent.click(explorer().getByRole('button', { name: /^Community 1/ }))
    fireEvent.click(inspector().getByRole('button', { name: 'Clear selection' }))
    expect(store().selectedCommunityId).toBeNull()
  })

  test('a path found across collapsed communities opens them while it is shown', () => {
    act(() => store().setFilters({ hideThirdParty: false }))
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('e')
    act(() => store().setCommunityMode(true))
    expect(store().path.status).toBe('idle')
    expect(aggregateIds()).toEqual([0, 1, 5, 9])

    // Decision A: path mode still works from a collapsed view.
    act(() => store().revealNode('a'))
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    act(() => store().revealNode('e'))

    expect(view()?.highlight?.kind).toBe('path')
    expect(sorted(view()?.highlight?.nodeIds ?? [])).toEqual(['a', 'b', 'c', 'd', 'e', 't1', 't2'])
    // Only the community the path does not touch is still an aggregate.
    expect(aggregateIds()).toEqual([9])

    fireEvent.click(inspector().getByRole('button', { name: 'Clear path' }))
    expect(aggregateIds()).toEqual([5, 9])
  })

  test('an expansion keeps the communities it reaches open, and collapsing ends it', () => {
    act(() => store().setFilters({ hideThirdParty: false }))
    act(() => store().setCommunityMode(true))
    act(() => store().revealNode('c'))

    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 2' }))
    expect(view()?.highlight?.kind).toBe('expansion')
    expect(aggregateIds()).toEqual([1, 9])

    act(() => store().setCommunityCollapsed(9, true))
    expect(store().expansion).toBeNull()
  })

  test('back and forward keep working around community selections', () => {
    click('a')
    click('d')
    fireEvent.click(explorer().getByRole('button', { name: /^Core API/ }))
    expect(store().history).toEqual(['a', 'd'])

    fireEvent.click(screen.getByRole('button', { name: /^Back to the previous node/ }))

    expect(store()).toMatchObject({ selectedNodeId: 'a', selectedCommunityId: null })
    expect(inspector().getByText('A', { selector: '.eog-node__name' })).toBeDefined()
  })

  test('a stage click clears the community selection too', () => {
    fireEvent.click(explorer().getByRole('button', { name: /^Core API/ }))

    act(() => fake.events.onStageClick?.())

    expect(store().selectedCommunityId).toBeNull()
  })

  test('a selection that is not a community of the graph is reported, with a way out', () => {
    act(() => store().selectCommunity(3))

    expect(screen.getByRole('alert').textContent).toContain('Community not available')
    fireEvent.click(inspector().getByRole('button', { name: 'Clear selection' }))
    expect(store().selectedCommunityId).toBeNull()
  })
})
