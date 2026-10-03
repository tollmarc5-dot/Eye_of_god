// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { ExplorerPanel } from '@/features/explorer/ExplorerPanel'
import { TopBar } from '@/features/hud/TopBar'
import { InspectorPanel } from '@/features/inspector/InspectorPanel'
import { GraphWorld } from '@/features/world/GraphWorld'
import { applyPositions, buildGraph, buildGraphIndex, DEFAULT_FILTERS } from '@/graph'
import type { GraphRenderer, RendererEvents, RendererViewState } from '@/renderer'
import { buildSearchIndex } from '@/search'
import { useAppStore } from '@/state/store'
import { makeRawGraph } from './fixtures'

// WebGL does not exist in jsdom: the world gets a renderer that records what
// the app asks of it. The real one is covered by renderer.test and the browser check.
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

const model = adaptGraphify(makeRawGraph())
const index = buildGraphIndex(model)
const graph = buildGraph(model)
const positions = new Map(model.nodes.map((node, order) => [node.id, { x: order, y: order }]))
applyPositions(graph, positions)
const initialState = useAppStore.getState()

function App() {
  const rendererRef = useRef<GraphRenderer | null>(null)
  return (
    <>
      <GraphWorld model={model} index={index} graph={graph} positions={positions} rendererRef={rendererRef} />
      <TopBar />
      <ExplorerPanel model={model} index={index} />
      <InspectorPanel model={model} index={index} graph={graph} />
    </>
  )
}

const store = () => useAppStore.getState()
const drawnIds = () => [...(fake.views.at(-1)?.visibleNodeIds ?? [])].sort()
const searchInput = () => screen.getByRole('combobox', { name: 'Search the graph' })
const inspector = () => within(screen.getByRole('region', { name: 'Node inspector' }))
const explorer = () => within(screen.getByRole('region', { name: 'Explorer' }))

function typeQuery(text: string) {
  fireEvent.focus(searchInput())
  fireEvent.change(searchInput(), { target: { value: text } })
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false })
  fake.views.length = 0
  fake.focusNode.mockClear()
  fake.frameNodes.mockClear()
  fake.resetCamera.mockClear()
  useAppStore.setState(
    {
      ...initialState,
      filters: DEFAULT_FILTERS,
      data: { status: 'ready', model, index, search: buildSearchIndex(model), graph, positions },
    },
    true,
  )
  render(<App />)
})

afterEach(cleanup)

describe('explorer → store → graph', () => {
  test('picking a community draws only that community and updates the counters', () => {
    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 2' }))

    expect(store().activeCommunity).toBe(2)
    expect(drawnIds()).toEqual(['docs_readme'])
    expect(screen.getByText('Nodes').nextElementSibling?.textContent).toBe('1 / 6')
    expect(explorer().getByText('1 / 6 nodes')).toBeDefined()
    expect(fake.resetCamera).toHaveBeenCalledOnce()
  })

  test('picking a project, then one of its folders, narrows the graph twice', () => {
    fireEvent.click(explorer().getByRole('switch', { name: /Third-party code/ }))
    fireEvent.click(explorer().getByRole('button', { name: /^app/ }))
    expect(drawnIds()).toEqual(['app_index', 'app_index_main', 'app_lib_xlsx_min_s'])

    fireEvent.click(explorer().getByRole('button', { name: /^public/ }))

    expect(store()).toMatchObject({ activeProject: 'app', activeFolder: 'public' })
    expect(drawnIds()).toEqual(['app_lib_xlsx_min_s'])
  })

  test('the active row is pressed, and pressing it again goes back to the whole graph', () => {
    const row = explorer().getByRole('button', { name: 'Show only Community 0' })
    const before = drawnIds()

    fireEvent.click(row)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(explorer().getByText('Community', { selector: '.eog-chip .eog-label' })).toBeDefined()

    fireEvent.click(row)
    expect(row.getAttribute('aria-pressed')).toBe('false')
    expect(drawnIds()).toEqual(before)
    expect(explorer().getByText('Whole graph')).toBeDefined()
  })

  test('clear scope and reset return to the global state', () => {
    const before = drawnIds()
    fireEvent.click(explorer().getByRole('button', { name: /^app/ }))
    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 0' }))
    fireEvent.click(explorer().getByRole('switch', { name: /Isolated nodes/ }))

    fireEvent.click(explorer().getByRole('button', { name: 'Clear scope' }))
    expect(store()).toMatchObject({ activeProject: null, activeFolder: null, activeCommunity: null })
    expect(store().filters.hideIsolated).toBe(true)

    fireEvent.click(explorer().getByRole('button', { name: 'Reset filters and scope' }))
    expect(store().filters).toEqual(DEFAULT_FILTERS)
    expect(drawnIds()).toEqual(before)
  })

  test('a scope chip clears just its own part', () => {
    fireEvent.click(explorer().getByRole('button', { name: /^app/ }))
    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 0' }))

    fireEvent.click(explorer().getByRole('button', { name: 'Clear project app' }))

    expect(store()).toMatchObject({ activeProject: null, activeCommunity: 0 })
  })

  test('a key node selects and focuses: it inspects, it does not filter', () => {
    const before = drawnIds()

    fireEvent.click(explorer().getByRole('button', { name: 'Inspect main()' }))

    expect(store().selectedNodeId).toBe('app_index_main')
    expect(drawnIds()).toEqual(before)
    expect(fake.focusNode).toHaveBeenCalledWith('app_index_main')
    expect(inspector().getByText('main()', { selector: '.eog-node__name' })).toBeDefined()
  })
})

describe('graph → store → inspector / explorer', () => {
  test('a click on the graph shows that node in the inspector', () => {
    act(() => fake.events.onNodeClick?.('os'))

    expect(store().selectedNodeId).toBe('os')
    expect(fake.views.at(-1)?.selectedNodeId).toBe('os')
    expect(inspector().getByText('os', { selector: '.eog-node__name' })).toBeDefined()
  })

  test('the explorer marks where the selected node lives without changing the scope', () => {
    act(() => fake.events.onNodeClick?.('app_index'))

    expect(explorer().getByRole('button', { name: /^app.*contains the selected node/ })).toBeDefined()
    expect(explorer().getByRole('button', { name: /^Community 0.*contains the selected node/ })).toBeDefined()
    expect(store().activeProject).toBeNull()
  })

  test('a click on the empty stage clears the selection everywhere', () => {
    act(() => fake.events.onNodeClick?.('os'))
    act(() => fake.events.onStageClick?.())

    expect(store().selectedNodeId).toBeNull()
    expect(inspector().getByText('No node selected')).toBeDefined()
  })
})

describe('search → selection → inspector', () => {
  test('lists results with enough context to tell them apart', () => {
    typeQuery('index')
    const options = screen.getAllByRole('option')

    expect(options).toHaveLength(2)
    expect(options[0]?.textContent).toContain('index.js')
    expect(options[0]?.textContent).toContain('app/src/index.js')
    expect(options[0]?.textContent).toContain('Community 0')
    expect(searchInput().getAttribute('aria-expanded')).toBe('true')
  })

  test('picking a result selects it, opens the inspector and focuses it', () => {
    store().setPanel('inspector', false)
    typeQuery('guia')

    fireEvent.click(screen.getByRole('option'))

    expect(store().selectedNodeId).toBe('docs_readme')
    expect(store().panels.inspector).toBe(true)
    expect(fake.focusNode).toHaveBeenCalledWith('docs_readme')
    expect(store().focusRequest).toBeNull()
    expect(inspector().getByText('Guía')).toBeDefined()
    expect(store().searchQuery).toBe('')
  })

  test('a result outside the view is flagged and revealed when picked', () => {
    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 2' }))
    typeQuery('xlsx')
    expect(screen.getByRole('option').textContent).toContain('Outside view')

    fireEvent.click(screen.getByRole('option'))

    expect(store().filters.hideThirdParty).toBe(false)
    expect(store().activeCommunity).toBeNull()
    expect(drawnIds()).toContain('app_lib_xlsx_min_s')
    expect(inspector().getByText('Third-party code')).toBeDefined()
  })

  test('says so when nothing matches', () => {
    typeQuery('zzz-not-there')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/No matches/)).toBeDefined()
  })
})

describe('filters against the selection', () => {
  test('a scope that hides the selected node deselects it', () => {
    act(() => fake.events.onNodeClick?.('os'))

    fireEvent.click(explorer().getByRole('button', { name: /^mhd-aplicación/ }))

    expect(store().selectedNodeId).toBeNull()
    expect(fake.views.at(-1)?.selectedNodeId).toBeNull()
    expect(inspector().getByText('No node selected')).toBeDefined()
  })

  test('a scope that still draws the selected node keeps it', () => {
    act(() => fake.events.onNodeClick?.('os'))

    fireEvent.click(explorer().getByRole('button', { name: 'Show only Community 0' }))

    expect(store().selectedNodeId).toBe('os')
  })

  test('hiding third-party code deselects a third-party node', () => {
    act(() => store().revealNode('app_lib_xlsx_min_s'))
    expect(store().selectedNodeId).toBe('app_lib_xlsx_min_s')

    fireEvent.click(explorer().getByRole('switch', { name: /Third-party code/ }))

    expect(store().filters.hideThirdParty).toBe(true)
    expect(store().selectedNodeId).toBeNull()
  })

  test('a folder cannot be active without its project', () => {
    act(() => store().setActiveFolder('src'))
    expect(store().activeFolder).toBeNull()

    act(() => store().setActiveProject('app'))
    act(() => store().setActiveFolder('src'))
    act(() => store().setActiveProject('mhd-aplicación'))

    expect(store().activeFolder).toBeNull()
  })
})

describe('keyboard', () => {
  test('arrow keys move through the results and Enter activates the active one', () => {
    typeQuery('index')
    const [first, second] = screen.getAllByRole('option')
    expect(searchInput().getAttribute('aria-activedescendant')).toBe(first?.id)

    fireEvent.keyDown(searchInput(), { key: 'ArrowDown' })
    expect(searchInput().getAttribute('aria-activedescendant')).toBe(second?.id)
    expect(second?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(searchInput(), { key: 'ArrowDown' })
    expect(searchInput().getAttribute('aria-activedescendant')).toBe(first?.id)
    fireEvent.keyDown(searchInput(), { key: 'ArrowUp' })
    fireEvent.keyDown(searchInput(), { key: 'Enter' })

    expect(store().selectedNodeId).toBe('app_index_main')
  })

  test('Escape cancels the search without selecting anything', () => {
    typeQuery('index')

    fireEvent.keyDown(searchInput(), { key: 'Escape' })

    expect(store().searchQuery).toBe('')
    expect(searchInput().getAttribute('aria-expanded')).toBe('false')
    expect(store().selectedNodeId).toBeNull()
  })

  test('"/" moves focus to the search from anywhere outside a text field', () => {
    fireEvent.keyDown(document.body, { key: '/' })

    expect(document.activeElement).toBe(searchInput())
  })

  test('explorer rows are real buttons: Tab reaches them and arrows walk the list', () => {
    const first = explorer().getByRole('button', { name: /^Community 0/ })
    const next = explorer().getByRole('button', { name: 'Show only Community 0' })
    expect(first.tabIndex).toBe(0)
    first.focus()

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(next, { key: 'ArrowUp' })

    expect(document.activeElement).toBe(first)
  })

  test('a collapsed explorer leaves the tab order', () => {
    act(() => store().setPanel('explorer', false))

    expect(document.querySelector('.eog-explorer')?.hasAttribute('inert')).toBe(true)
  })

  test('keyboard focus stays visible: the global :focus-visible ring is not removed', () => {
    const base = readFileSync('src/styles/base.css', 'utf8')
    const components = readFileSync('src/styles/components.css', 'utf8')

    expect(base).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px/)
    // Only the search input drops its outline, and its wrapper shows the focus instead.
    expect(components.match(/outline:\s*none/g)).toHaveLength(1)
    expect(components).toContain('.eog-search:focus-within')
  })
})
