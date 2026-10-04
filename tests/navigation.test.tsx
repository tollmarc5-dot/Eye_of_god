// @vitest-environment jsdom
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { GraphControls } from '@/features/hud/GraphControls'
import { useNavigationKeys } from '@/features/hud/navigation-keys'
import { NavigationStatus } from '@/features/hud/NavigationStatus'
import { TopBar } from '@/features/hud/TopBar'
import { InspectorPanel } from '@/features/inspector/InspectorPanel'
import { GraphCommandsContext, type GraphCommands } from '@/features/world/graph-commands'
import { GraphWorld } from '@/features/world/GraphWorld'
import {
  applyPositions,
  buildGraph,
  buildGraphIndex,
  computeVisibleNodeIds,
  DEFAULT_FILTERS,
  expandNeighborhood,
  findPath,
  MAX_EXPANSION_NODES,
} from '@/graph'
import type { GraphRenderer, RendererEvents, RendererViewState } from '@/renderer'
import { computeFocus, createReducers, EMPTY_VIEW_STATE } from '@/renderer/reducers'
import { buildSearchIndex } from '@/search'
import { MAX_HISTORY, useAppStore } from '@/state/store'
import { CANVAS_THEME } from '@/styles/canvas-theme'

const fake = vi.hoisted(() => ({
  events: {} as RendererEvents,
  views: [] as RendererViewState[],
  focusNode: vi.fn((_nodeId: string) => true),
  frameNodes: vi.fn((_nodeIds: Iterable<string>) => true),
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
      resetCamera: vi.fn(),
      getCamera: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }),
      setCamera: vi.fn(),
      getNodeViewportPosition: () => null,
      getMotionQuality: () => 'still',
      destroy: vi.fn(),
    }
  },
}))

/**
 * a → b ← c → d → e → t → f      t is third-party, f is only reachable through it
 * a → h → l0..l4                 a small star two hops from a
 * i1 → i2                        an island
 * z                              isolated
 */
function makeNavigationGraph() {
  const node = (id: string, file = 'app/src/nav.js', community = 0) => ({
    id,
    label: id.toUpperCase(),
    norm_label: id,
    community,
    file_type: 'code',
    source_file: file,
    source_location: 'L1',
    _origin: 'ast',
  })
  const link = (source: string, target: string, relation = 'calls') => ({
    source,
    target,
    relation,
    confidence: 'EXTRACTED',
    confidence_score: 1,
    weight: 1,
    source_file: 'app/src/nav.js',
    source_location: 'L1',
  })
  const leaves = [0, 1, 2, 3, 4].map((order) => `l${order}`)
  return {
    directed: false,
    multigraph: false,
    graph: {},
    nodes: [
      ...['a', 'b', 'c', 'd', 'e', 'f', 'h', ...leaves].map((id) => node(id)),
      node('t', 'app/public/lib/vendor.min.js', 1),
      node('i1', 'docs/island.md', 2),
      node('i2', 'docs/island.md', 2),
      node('z', 'LICENSE', 3),
    ],
    links: [
      link('a', 'b'),
      link('c', 'b', 'imports'),
      link('c', 'd'),
      link('d', 'e'),
      link('e', 't'),
      link('t', 'f'),
      link('a', 'h', 'contains'),
      ...leaves.map((leaf) => link('h', leaf, 'contains')),
      link('i1', 'i2', 'references'),
    ],
    hyperedges: [],
  }
}

const model = adaptGraphify(makeNavigationGraph())
const index = buildGraphIndex(model)
const graph = buildGraph(model)
const positions = new Map(model.nodes.map((node, order) => [node.id, { x: order, y: order }]))
applyPositions(graph, positions)
const firstParty = computeVisibleNodeIds(model, DEFAULT_FILTERS)
const everything = computeVisibleNodeIds(model, { ...DEFAULT_FILTERS, hideThirdParty: false })
const initialState = useAppStore.getState()
const store = () => useAppStore.getState()
const sorted = (ids: Iterable<string>) => [...ids].sort()

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

describe('expandNeighborhood', () => {
  test('depth 1 is the node and its direct neighbours, whatever the edge direction', () => {
    expect(sorted(expandNeighborhood(graph, 'b', 1)?.nodeIds ?? [])).toEqual(['a', 'b', 'c'])
  })

  test('depth 2 and 3 add one hop each', () => {
    expect(sorted(expandNeighborhood(graph, 'a', 1)?.nodeIds ?? [])).toEqual(['a', 'b', 'h'])
    expect(sorted(expandNeighborhood(graph, 'a', 2)?.nodeIds ?? [])).toEqual(
      ['a', 'b', 'c', 'h', 'l0', 'l1', 'l2', 'l3', 'l4'].sort(),
    )
    expect(expandNeighborhood(graph, 'a', 3)?.nodeIds.has('d')).toBe(true)
    expect(expandNeighborhood(graph, 'a', 3)?.nodeIds.has('e')).toBe(false)
  })

  test('never goes further than the depth asked, and 3 is the deepest there is', () => {
    const deepest = expandNeighborhood(graph, 'a', 3)

    expect(deepest?.depth).toBe(3)
    expect(sorted(deepest?.nodeIds ?? [])).not.toContain('t')
    expect(deepest?.isTruncated).toBe(false)
  })

  test('an isolated node expands to itself', () => {
    expect(expandNeighborhood(graph, 'z', 3)).toMatchObject({ isTruncated: false, hiddenNeighborCount: 0 })
    expect(sorted(expandNeighborhood(graph, 'z', 3)?.nodeIds ?? [])).toEqual(['z'])
  })

  test('stays inside the allowed nodes and counts the neighbours it had to skip', () => {
    const filtered = expandNeighborhood(graph, 'e', 2, { allowedNodeIds: firstParty })
    const full = expandNeighborhood(graph, 'e', 2, { allowedNodeIds: everything })

    // t is third-party: not entered, so f behind it is never reached.
    expect(sorted(filtered?.nodeIds ?? [])).toEqual(['c', 'd', 'e'])
    expect(filtered?.hiddenNeighborCount).toBe(1)
    expect(sorted(full?.nodeIds ?? [])).toEqual(['c', 'd', 'e', 'f', 't'])
    expect(full?.hiddenNeighborCount).toBe(0)
  })

  test('a root that is not drawn, or not in the graph, has no expansion', () => {
    expect(expandNeighborhood(graph, 't', 1, { allowedNodeIds: firstParty })).toBeNull()
    expect(expandNeighborhood(graph, 'ghost', 1)).toBeNull()
  })

  test('stops at the node limit, deterministically, and says so', () => {
    const limited = expandNeighborhood(graph, 'a', 3, { maxNodes: 4 })

    expect(limited?.nodeIds.size).toBe(4)
    expect(limited?.isTruncated).toBe(true)
    // Breadth first: the direct neighbours come before anything further away.
    expect([...(limited?.nodeIds ?? [])].slice(0, 3)).toEqual(['a', 'b', 'h'])
    expect([...(expandNeighborhood(graph, 'a', 3, { maxNodes: 4 })?.nodeIds ?? [])]).toEqual([
      ...(limited?.nodeIds ?? []),
    ])
  })

  test('the default limit holds on a star far larger than it', () => {
    const size = MAX_EXPANSION_NODES * 3
    const raw = makeNavigationGraph()
    const template = raw.nodes[0]
    const linkTemplate = raw.links[0]
    if (!template || !linkTemplate) throw new Error('fixture is empty')
    const star = buildGraph(
      adaptGraphify({
        ...raw,
        nodes: [...raw.nodes, ...Array.from({ length: size }, (_v, order) => ({ ...template, id: `s${order}`, label: `S${order}` }))],
        links: [...raw.links, ...Array.from({ length: size }, (_v, order) => ({ ...linkTemplate, source: 'a', target: `s${order}` }))],
      }),
    )

    const expansion = expandNeighborhood(star, 'a', 3)

    expect(expansion?.nodeIds.size).toBe(MAX_EXPANSION_NODES)
    expect(expansion?.isTruncated).toBe(true)
  })
})

describe('findPath', () => {
  test('finds a path of several hops and the real relations of each hop', () => {
    const path = findPath(graph, index, 'a', 'e', firstParty)

    expect(path?.nodeIds).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(path?.steps.map((step) => step.edges.map((edge) => edge.relation))).toEqual([
      ['calls'],
      ['imports'],
      ['calls'],
      ['calls'],
    ])
    expect(sorted(path?.edgeIds ?? [])).toEqual(['a|calls|b', 'c|calls|d', 'c|imports|b', 'd|calls|e'])
  })

  test('walks edges against their direction and says which hops do', () => {
    const path = findPath(graph, index, 'a', 'e')

    // b → c is walked against "c imports b".
    expect(path?.steps.map((step) => step.isForward)).toEqual([true, false, true, true])
  })

  test('A → A is a path with one node and no hop', () => {
    const path = findPath(graph, index, 'a', 'a')

    expect(path?.nodeIds).toEqual(['a'])
    expect(path?.steps).toEqual([])
    expect(path?.edgeIds.size).toBe(0)
  })

  test('returns null between components that are not connected', () => {
    expect(findPath(graph, index, 'a', 'i1')).toBeNull()
    expect(findPath(graph, index, 'a', 'z')).toBeNull()
    expect(findPath(graph, index, 'a', 'ghost')).toBeNull()
  })

  test('does not run through hidden nodes, nor end on one', () => {
    expect(findPath(graph, index, 'a', 'f', firstParty)).toBeNull()
    expect(findPath(graph, index, 'a', 't', firstParty)).toBeNull()
    expect(findPath(graph, index, 'a', 'f', everything)?.nodeIds).toEqual(['a', 'b', 'c', 'd', 'e', 't', 'f'])
  })

  test('handles a long path', () => {
    const length = 400
    const raw = makeNavigationGraph()
    const template = raw.nodes[0]
    const linkTemplate = raw.links[0]
    if (!template || !linkTemplate) throw new Error('fixture is empty')
    const chainModel = adaptGraphify({
      ...raw,
      nodes: Array.from({ length }, (_v, order) => ({ ...template, id: `n${order}`, label: `N${order}` })),
      links: Array.from({ length: length - 1 }, (_v, order) => ({ ...linkTemplate, source: `n${order}`, target: `n${order + 1}` })),
    })
    const chain = buildGraph(chainModel)

    const path = findPath(chain, buildGraphIndex(chainModel), 'n0', `n${length - 1}`)

    expect(path?.nodeIds).toHaveLength(length)
    expect(path?.steps).toHaveLength(length - 1)
    expect(path?.edgeIds.size).toBe(length - 1)
  })
})

describe('history (store)', () => {
  beforeEach(resetStore)
  const visit = (...ids: string[]) => ids.forEach((id) => store().selectNode(id))

  test('A → B → C, then back and forward', () => {
    visit('a', 'b', 'c')
    expect(store()).toMatchObject({ history: ['a', 'b', 'c'], historyIndex: 2 })

    store().goBack()
    expect(store()).toMatchObject({ selectedNodeId: 'b', historyIndex: 1, focusRequest: 'b' })
    store().goBack()
    expect(store().selectedNodeId).toBe('a')

    store().goForward()
    store().goForward()
    expect(store()).toMatchObject({ selectedNodeId: 'c', history: ['a', 'b', 'c'], historyIndex: 2 })
  })

  test('back and forward stop at the ends', () => {
    visit('a', 'b')

    store().goForward()
    expect(store().selectedNodeId).toBe('b')
    store().goBack()
    store().goBack()

    expect(store()).toMatchObject({ selectedNodeId: 'a', historyIndex: 0 })
  })

  test('navigating after going back drops the forward branch', () => {
    visit('a', 'b', 'c')
    store().goBack()

    store().selectNode('d')

    expect(store()).toMatchObject({ history: ['a', 'b', 'd'], historyIndex: 2 })
    store().goForward()
    expect(store().selectedNodeId).toBe('d')
  })

  test('the same node is never recorded twice in a row', () => {
    visit('a', 'a', 'b')
    store().revealNode('b')

    expect(store().history).toEqual(['a', 'b'])
  })

  test('stores ids only, and never more than the cap', () => {
    for (let round = 0; round < MAX_HISTORY; round += 1) visit('a', 'b')

    expect(store().history).toHaveLength(MAX_HISTORY)
    expect(store().history.every((entry) => typeof entry === 'string')).toBe(true)
    expect(store().historyIndex).toBe(MAX_HISTORY - 1)
  })

  test('camera, filters, scope, panels and clearing the selection record nothing', () => {
    visit('a', 'b')
    const before = { history: store().history, historyIndex: store().historyIndex }

    store().setView({ level: 'detail', zoomPercent: 500 })
    store().setFilters({ hideIsolated: true })
    store().setActiveCommunity(0)
    store().setPanel('explorer', false)
    store().setPreferences({ showEdges: false })
    store().selectNode(null)
    store().clearScope()
    store().resetExploration()

    expect({ history: store().history, historyIndex: store().historyIndex }).toEqual(before)
  })

  test('going back to a node the filters now hide reveals it instead of selecting nothing', () => {
    store().revealNode('t')
    store().selectNode('e')
    store().setFilters({ hideThirdParty: true })

    store().goBack()

    expect(store().selectedNodeId).toBe('t')
    expect(store().filters.hideThirdParty).toBe(false)
  })
})

describe('path and expansion modes (store)', () => {
  beforeEach(resetStore)

  test('path mode needs an origin: nothing happens without a selection', () => {
    store().startPath()

    expect(store().path).toEqual({ status: 'idle' })
  })

  test('while picking, the next selected node is the destination and becomes the selection', () => {
    store().selectNode('a')
    store().startPath()
    expect(store().path).toEqual({ status: 'picking', fromId: 'a' })

    store().selectNode('e')

    expect(store().path).toEqual({ status: 'set', fromId: 'a', toId: 'e' })
    expect(store()).toMatchObject({ selectedNodeId: 'e', history: ['a', 'e'] })
  })

  test('a click on the empty stage does not cancel picking; clearPath does', () => {
    store().selectNode('a')
    store().startPath()

    store().selectNode(null)
    expect(store().path.status).toBe('picking')

    store().clearPath()
    expect(store().path).toEqual({ status: 'idle' })
  })

  test('once a path is set, selecting nodes is ordinary navigation again', () => {
    store().selectNode('a')
    store().startPath()
    store().selectNode('e')

    store().selectNode('c')

    expect(store().path).toEqual({ status: 'set', fromId: 'a', toId: 'e' })
    expect(store().selectedNodeId).toBe('c')
  })

  test('an expansion belongs to the selected node and ends when another is selected', () => {
    store().selectNode('a')
    store().setExpansion('b', 2)
    expect(store().expansion).toBeNull()

    store().setExpansion('a', 2)
    expect(store().expansion).toEqual({ rootId: 'a', depth: 2 })

    store().selectNode('b')
    expect(store().expansion).toBeNull()
  })

  test('path and expansion replace each other', () => {
    store().selectNode('a')
    store().setExpansion('a', 1)
    store().startPath()
    expect(store().expansion).toBeNull()

    store().selectNode('a')
    store().setExpansion('a', 3)
    expect(store().path).toEqual({ status: 'idle' })
  })

  test('a scope that hides the expanded node ends the expansion with the selection', () => {
    store().selectNode('a')
    store().setExpansion('a', 2)

    store().setActiveCommunity(2)

    expect(store()).toMatchObject({ selectedNodeId: null, expansion: null })
  })
})

describe('renderer highlight', () => {
  function reduce(view: Partial<RendererViewState>, hoveredNodeId: string | null = null) {
    const state: RendererViewState = { ...EMPTY_VIEW_STATE, ...view }
    const focus = computeFocus(graph, state, hoveredNodeId)
    const reducers = createReducers(graph, () => state, () => focus)
    return {
      node: (id: string) => reducers.nodeReducer(id, { ...graph.getNodeAttributes(id) }) as Record<string, unknown>,
      edge: (id: string) => reducers.edgeReducer(id, { ...graph.getEdgeAttributes(id) }) as Record<string, unknown>,
    }
  }
  const path = findPath(graph, index, 'a', 'e')
  if (!path) throw new Error('fixture path is missing')
  const pathHighlight = { kind: 'path' as const, nodeIds: new Set(path.nodeIds), edgeIds: path.edgeIds }

  test('a path lights its nodes and relations and dims the rest', () => {
    const { node, edge } = reduce({ selectedNodeId: 'e', highlight: pathHighlight })

    expect(node('c')).toMatchObject({ glow: 1, forceLabel: true })
    expect(node('c').color).not.toBe(CANVAS_THEME.nodeDimmed)
    expect(node('h')).toMatchObject({ glow: 0, color: CANVAS_THEME.nodeDimmed })
    expect(edge('c|imports|b')).toMatchObject({ color: CANVAS_THEME.edgeFocus, flow: 1 })
    expect(edge('a|contains|h').color).toBe(CANVAS_THEME.edgeDimmed)
  })

  test('the selected end of the path keeps the selection ring', () => {
    const { node } = reduce({ selectedNodeId: 'e', highlight: pathHighlight })

    expect(node('e').accent).toBe(1)
    expect(node('a').accent).toBeLessThan(1)
  })

  test('an expansion keeps every node of the set lit, not only direct neighbours', () => {
    const nodeIds = expandNeighborhood(graph, 'a', 2)?.nodeIds ?? new Set<string>()
    const { node, edge } = reduce({ selectedNodeId: 'a', highlight: { kind: 'expansion', nodeIds, edgeIds: null } })

    // l0 is two hops away: dimmed by plain selection, lit by the expansion.
    expect(node('l0').color).not.toBe(CANVAS_THEME.nodeDimmed)
    expect(reduce({ selectedNodeId: 'a' }).node('l0').color).toBe(CANVAS_THEME.nodeDimmed)
    expect(node('d').color).toBe(CANVAS_THEME.nodeDimmed)
    expect(edge('h|contains|l0').color).not.toBe(CANVAS_THEME.edgeDimmed)
    expect(edge('c|calls|d').color).toBe(CANVAS_THEME.edgeDimmed)
  })

  test('hover still answers inside an expansion', () => {
    const nodeIds = expandNeighborhood(graph, 'a', 2)?.nodeIds ?? new Set<string>()
    const { node, edge } = reduce(
      { selectedNodeId: 'a', highlight: { kind: 'expansion', nodeIds, edgeIds: null } },
      'h',
    )

    expect(node('h')).toMatchObject({ highlighted: true, glow: 1 })
    expect(edge('h|contains|l0').color).toBe(CANVAS_THEME.edgeFocus)
  })
})

describe('navigation in the interface', () => {
  function App() {
    const rendererRef = useRef<GraphRenderer | null>(null)
    useNavigationKeys()
    const commands: GraphCommands = {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetCamera: vi.fn(),
      focusNode: (nodeId) => rendererRef.current?.focusNode(nodeId),
      expandNode: (nodeId, depth) => store().setExpansion(nodeId, depth),
      focusCommunity: vi.fn(),
    }
    return (
      <GraphCommandsContext.Provider value={commands}>
        <GraphWorld model={model} index={index} graph={graph} positions={positions} rendererRef={rendererRef} />
        <TopBar />
        <InspectorPanel model={model} index={index} graph={graph} />
        <GraphControls />
        <NavigationStatus model={model} index={index} graph={graph} />
      </GraphCommandsContext.Provider>
    )
  }

  const inspector = () => within(screen.getByRole('region', { name: 'Node inspector' }))
  const inspected = () => inspector().getByText(/./, { selector: '.eog-node__name' }).textContent
  const backButton = () => screen.getByRole('button', { name: /^Back to the previous node/ })
  const forwardButton = () => screen.getByRole('button', { name: /^Forward to the next node/ })
  const click = (nodeId: string) => act(() => fake.events.onNodeClick?.(nodeId))
  const highlight = () => fake.views.at(-1)?.highlight ?? null
  const lastFramed = () => sorted(fake.frameNodes.mock.calls.at(-1)?.[0] ?? [])

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    fake.views.length = 0
    fake.focusNode.mockClear()
    fake.frameNodes.mockClear()
    resetStore()
    render(<App />)
  })

  afterEach(cleanup)

  test('back and forward are disabled until there is somewhere to go', () => {
    expect(backButton()).toHaveProperty('disabled', true)
    expect(forwardButton()).toHaveProperty('disabled', true)

    click('a')
    expect(backButton()).toHaveProperty('disabled', true)
    click('b')

    expect(backButton()).toHaveProperty('disabled', false)
    expect(forwardButton()).toHaveProperty('disabled', true)
  })

  test('back and forward move the selection, the inspector and the camera together', () => {
    click('a')
    click('b')

    fireEvent.click(backButton())
    expect(inspected()).toBe('A')
    expect(fake.views.at(-1)?.selectedNodeId).toBe('a')
    expect(fake.focusNode).toHaveBeenLastCalledWith('a')
    expect(forwardButton()).toHaveProperty('disabled', false)

    fireEvent.click(forwardButton())
    expect(inspected()).toBe('B')
    expect(fake.focusNode).toHaveBeenLastCalledWith('b')
    expect(store().focusRequest).toBeNull()
  })

  test('"[" and "]" walk the history from the keyboard', () => {
    click('a')
    click('b')

    fireEvent.keyDown(document.body, { key: '[' })
    expect(inspected()).toBe('A')

    fireEvent.keyDown(document.body, { key: ']' })
    expect(inspected()).toBe('B')
  })

  test('navigating from the connected nodes list is recorded, and back returns', () => {
    click('a')

    fireEvent.click(inspector().getByRole('button', { name: 'Outgoing to H, contains. Inspect' }))
    expect(inspected()).toBe('H')
    expect(store().history).toEqual(['a', 'h'])

    fireEvent.click(backButton())
    expect(inspected()).toBe('A')
  })

  test('a search result is recorded in the same history', () => {
    click('a')
    const input = screen.getByRole('combobox', { name: 'Search the graph' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'i2' } })

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(store().history).toEqual(['a', 'i2'])
    fireEvent.click(backButton())
    expect(inspected()).toBe('A')
  })

  test('expanding lights and frames the neighbourhood at each depth', () => {
    click('a')

    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 1' }))
    expect(highlight()?.kind).toBe('expansion')
    expect(sorted(highlight()?.nodeIds ?? [])).toEqual(['a', 'b', 'h'])
    expect(lastFramed()).toEqual(['a', 'b', 'h'])

    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 2' }))
    expect(highlight()?.nodeIds.size).toBe(9)
    expect(inspector().getByText('Depth 2 · 9 nodes')).toBeDefined()

    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 3' }))
    expect(highlight()?.nodeIds.has('d')).toBe(true)
    expect(inspector().getByRole('button', { name: 'Expand to depth 3' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('pressing the active depth again, or Escape, ends the expansion', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 2' }))

    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 2' }))
    expect(highlight()).toBeNull()

    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 1' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(highlight()).toBeNull()
    expect(store().selectedNodeId).toBe('a')
  })

  test('an expansion follows the filters: third-party neighbours appear only when drawn', () => {
    click('e')
    fireEvent.click(inspector().getByRole('button', { name: 'Expand to depth 2' }))
    expect(sorted(highlight()?.nodeIds ?? [])).toEqual(['c', 'd', 'e'])
    expect(inspector().getByText('Depth 2 · 3 nodes · 1 outside the current view')).toBeDefined()

    act(() => store().setFilters({ hideThirdParty: false }))

    expect(sorted(highlight()?.nodeIds ?? [])).toEqual(['c', 'd', 'e', 'f', 't'])
    expect(sorted(fake.views.at(-1)?.visibleNodeIds ?? [])).toContain('t')
    expect(model.nodes).toHaveLength(16)
  })

  test('an isolated node cannot be expanded', () => {
    click('z')

    expect(inspector().getByRole('button', { name: /^Expand to depth 1/ })).toHaveProperty('disabled', true)
  })

  test('path: pick an origin, enter the mode, pick the destination, see the route', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    expect(screen.getByText('Select the destination node')).toBeDefined()
    expect(highlight()).toBeNull()

    click('e')

    expect(highlight()?.kind).toBe('path')
    expect(sorted(highlight()?.nodeIds ?? [])).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(highlight()?.edgeIds?.size).toBe(4)
    expect(lastFramed()).toEqual(['a', 'b', 'c', 'd', 'e'])
    // The destination is inspected like any other selection.
    expect(inspected()).toBe('E')
    expect(inspector().getByText('4 hops · 5 nodes')).toBeDefined()
    expect(inspector().getByRole('button', { name: 'Step 3: C. Inspect' })).toBeDefined()
    expect(inspector().getByRole('listitem', { name: 'reached against the relation imports' })).toBeDefined()
  })

  test('a step of the route can be inspected without losing the path', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('e')

    fireEvent.click(inspector().getByRole('button', { name: 'Step 3: C. Inspect' }))

    expect(inspected()).toBe('C')
    expect(highlight()?.kind).toBe('path')
    expect(store().history).toEqual(['a', 'e', 'c'])
  })

  test('clear path returns to the normal view and keeps the selection', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('e')

    fireEvent.click(inspector().getByRole('button', { name: 'Clear path' }))

    expect(highlight()).toBeNull()
    expect(store().selectedNodeId).toBe('e')
    expect(screen.queryByRole('region', { name: 'Path' })).toBeNull()
  })

  test('no path found is reported and the selection still works normally', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('i1')

    expect(highlight()).toBeNull()
    expect(inspector().getByText('No path found', { selector: '.eog-path__title' })).toBeDefined()
    expect(inspector().getByText('A and I1 are not connected in the graph.')).toBeDefined()
    expect(inspected()).toBe('I1')

    click('b')
    expect(inspected()).toBe('B')
  })

  test('a path that only exists through hidden nodes says so, and appears when they are drawn', () => {
    act(() => store().revealNode('f'))
    act(() => store().setFilters({ hideThirdParty: true }))
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('f')

    expect(highlight()).toBeNull()
    expect(inspector().getByText(/only connected through nodes that the current filters or scope hide/)).toBeDefined()

    act(() => store().setFilters({ hideThirdParty: false }))

    expect(sorted(highlight()?.nodeIds ?? [])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 't'])
    expect(inspector().getByText('6 hops · 7 nodes')).toBeDefined()
  })

  test('picking the origin itself is handled: one node, nothing to walk', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))

    click('a')

    expect(inspector().getByText(/Origin and destination are the same node/)).toBeDefined()
    expect(sorted(highlight()?.nodeIds ?? [])).toEqual(['a'])
    expect(inspected()).toBe('A')
  })

  test('Escape cancels path mode, and later clears a shown path', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(store().path.status).toBe('idle')
    expect(screen.queryByText('Select the destination node')).toBeNull()

    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('e')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(highlight()).toBeNull()
    expect(store().selectedNodeId).toBe('e')
  })

  test('Escape typed in the search field does not cancel path mode', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    const input = screen.getByRole('combobox', { name: 'Search the graph' })
    fireEvent.change(input, { target: { value: 'e' } })

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(store().path.status).toBe('picking')
  })

  test('the status banner offers the way out with every panel closed', () => {
    click('a')
    fireEvent.click(inspector().getByRole('button', { name: /^Path to/ }))
    click('e')
    act(() => store().setPanel('inspector', false))
    const banner = within(screen.getAllByRole('status').find((element) => element.className === 'eog-mode') as HTMLElement)

    expect(banner.getByText('4 hops')).toBeDefined()
    fireEvent.click(banner.getByRole('button', { name: 'Clear path' }))

    expect(store().path.status).toBe('idle')
  })
})
