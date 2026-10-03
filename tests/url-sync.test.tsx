// @vitest-environment jsdom
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { ShareButton } from '@/features/hud/ShareButton'
import { GraphWorld } from '@/features/world/GraphWorld'
import { applyPositions, buildGraph, buildGraphIndex, DEFAULT_FILTERS } from '@/graph'
import type { GraphRenderer, RendererEvents } from '@/renderer'
import { buildSearchIndex } from '@/search'
import { snapshotView, useAppStore } from '@/state/store'
import { decodeViewState, DEFAULT_VIEW_STATE, type ViewState } from '@/state/url-state'
import { CAMERA_SETTLE_MS, currentViewUrl, restoreViewFromUrl, startUrlSync } from '@/state/url-sync'
import { makeRawGraph } from './fixtures'

const fake = vi.hoisted(() => ({
  events: {} as RendererEvents,
  focusNode: vi.fn((_nodeId: string) => true),
  frameNodes: vi.fn((_nodeIds: Iterable<string>) => true),
  setCamera: vi.fn(),
}))

// The real module pulls in Sigma, which needs WebGL just to be imported.
vi.mock('@/renderer', () => ({
  createSigmaRenderer: (_container: HTMLElement, _graph: unknown, events: RendererEvents): GraphRenderer => {
    fake.events = events
    return {
      setViewState: vi.fn(),
      focusNode: fake.focusNode,
      frameNeighborhood: vi.fn(() => true),
      frameNodes: fake.frameNodes,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetCamera: vi.fn(),
      getCamera: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }),
      setCamera: fake.setCamera,
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
const store = () => useAppStore.getState()
const view = (patch: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW_STATE, ...patch })
const query = () => window.location.search
/** jsdom delivers popstate asynchronously, like a browser. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

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

let stopSync: (() => void) | null = null

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  resetStore()
})

afterEach(() => {
  stopSync?.()
  stopSync = null
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('restoring a view into the store', () => {
  test('snapshot and restore are inverse for everything that is persisted', () => {
    const target = view({
      nodeId: 'app_index_main',
      project: 'app',
      folder: 'src',
      showIsolated: false,
      showRelations: false,
      aggregation: { mode: 'nodes', exceptions: [2] },
      expansionDepth: 2,
    })

    store().restoreView(target)

    expect(snapshotView(store())).toEqual(target)
    expect(store()).toMatchObject({ activeProject: 'app', activeFolder: 'src', expansion: { rootId: 'app_index_main', depth: 2 } })
    expect(store().filters.hideIsolated).toBe(true)
  })

  test('the restored node starts the internal history and asks for focus', () => {
    store().restoreView(view({ nodeId: 'os' }))

    expect(store()).toMatchObject({ selectedNodeId: 'os', history: ['os'], historyIndex: 0, focusRequest: 'os' })
    expect(store().panels.inspector).toBe(true)
  })

  test('a restored camera replaces the automatic focus', () => {
    store().restoreView(view({ nodeId: 'os', camera: { x: 0.2, y: 0.3, ratio: 0.5 } }))

    expect(store().cameraRequest).toEqual({ x: 0.2, y: 0.3, ratio: 0.5 })
    expect(store().focusRequest).toBeNull()
  })

  test('a link whose filters would hide its own node still shows the node', () => {
    store().restoreView(view({ nodeId: 'app_lib_xlsx_min_s', showThirdParty: false }))

    expect(store().selectedNodeId).toBe('app_lib_xlsx_min_s')
    expect(store().filters.hideThirdParty).toBe(false)
  })

  test('a community, community view and a path are restored from ids alone', () => {
    store().restoreView(
      view({
        communityId: 2,
        aggregation: { mode: 'communities', exceptions: [0] },
        path: { fromId: 'app_index', toId: 'os' },
      }),
    )

    expect(store()).toMatchObject({
      selectedCommunityId: 2,
      selectedNodeId: null,
      aggregation: { mode: 'communities', exceptions: [0] },
      path: { status: 'set', fromId: 'app_index', toId: 'os' },
    })
  })

  test('restoring replaces the previous view instead of adding to it', () => {
    store().restoreView(view({ nodeId: 'os', project: 'app', showThirdParty: true, expansionDepth: 1 }))

    store().restoreView(DEFAULT_VIEW_STATE)

    expect(snapshotView(store())).toEqual(DEFAULT_VIEW_STATE)
    expect(store().filters).toEqual(DEFAULT_FILTERS)
  })

  test('restoreViewFromUrl validates against the loaded graph and survives garbage', () => {
    restoreViewFromUrl('?node=ghost&community=2&cam=x&thirdParty=1&project=nope')

    expect(snapshotView(store())).toEqual(view({ communityId: 2, showThirdParty: true }))
  })

  test('nothing is restored before the graph is loaded', () => {
    useAppStore.setState({ data: { status: 'loading', stage: 'layout' } })

    restoreViewFromUrl('?node=os')

    expect(store().selectedNodeId).toBeNull()
  })
})

describe('store → URL', () => {
  test('starting writes the canonical form of the current view once', () => {
    window.history.replaceState(null, '', '/?node=ghost&thirdParty=1&junk=1')
    restoreViewFromUrl(query())

    stopSync = startUrlSync()

    expect(query()).toBe('?thirdParty=1')
  })

  test('selecting a node is navigation: a new browser entry', () => {
    stopSync = startUrlSync()
    const entries = window.history.length

    act(() => store().selectNode('os'))

    expect(query()).toBe('?node=os')
    expect(window.history.length).toBe(entries + 1)
  })

  test('community, community view, scope and path are navigation too', () => {
    stopSync = startUrlSync()
    const pushState = vi.spyOn(window.history, 'pushState')

    act(() => store().selectCommunity(2))
    act(() => store().setCommunityMode(true))
    act(() => store().setActiveProject('app'))
    act(() => store().selectNode('app_index'))
    act(() => store().startPath())
    act(() => store().selectNode('os'))

    expect(pushState).toHaveBeenCalledTimes(5)
    // Starting to pick is not a view yet: nothing was written for it.
    expect(query()).toBe('?node=os&project=app&view=communities&expanded=0&from=app_index&to=os')
  })

  test('switches, collapse and expansion rewrite the current entry', () => {
    stopSync = startUrlSync()
    act(() => store().selectNode('app_index'))
    const entries = window.history.length
    const pushState = vi.spyOn(window.history, 'pushState')

    act(() => store().setFilters({ hideThirdParty: false }))
    act(() => store().setPreferences({ showEdges: false }))
    act(() => store().setCommunityCollapsed(2, true))
    act(() => store().setExpansion('app_index', 2))

    expect(query()).toBe('?node=app_index&thirdParty=1&relations=0&collapsed=2&expand=2')
    expect(window.history.length).toBe(entries)
    expect(pushState).not.toHaveBeenCalled()
  })

  test('things that are not part of a view never touch the URL', () => {
    stopSync = startUrlSync()
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const pushState = vi.spyOn(window.history, 'pushState')

    act(() => store().setPanel('explorer', false))
    act(() => store().setSearchQuery('index'))
    act(() => store().setView({ level: 'detail', zoomPercent: 500 }))
    act(() => store().recordMetrics({ firstRenderMs: 1 }))
    act(() => store().setLayoutRunning(true))

    expect(replaceState).not.toHaveBeenCalled()
    expect(pushState).not.toHaveBeenCalled()
    expect(query()).toBe('')
  })

  test('the camera is written once it rests, not while it moves', () => {
    vi.useFakeTimers()
    stopSync = startUrlSync()
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const pushState = vi.spyOn(window.history, 'pushState')

    for (let step = 1; step <= 30; step += 1) {
      store().setCamera({ x: 0.5, y: 0.5, ratio: 1 - step * 0.02, angle: 0 })
      vi.advanceTimersByTime(CAMERA_SETTLE_MS / 4)
    }
    expect(replaceState).not.toHaveBeenCalled()

    vi.advanceTimersByTime(CAMERA_SETTLE_MS)

    expect(replaceState).toHaveBeenCalledOnce()
    expect(pushState).not.toHaveBeenCalled()
    expect(query()).toBe('?cam=0.5%2C0.5%2C0.4')
  })

  test('a navigation while the camera is still moving is written at once, camera included', () => {
    vi.useFakeTimers()
    stopSync = startUrlSync()
    store().setCamera({ x: 0.3, y: 0.5, ratio: 0.5, angle: 0 })

    store().selectNode('os')

    expect(query()).toBe('?node=os&cam=0.3%2C0.5%2C0.5')
  })

  test('stopping the sync stops the writing', () => {
    startUrlSync()()

    act(() => store().selectNode('os'))

    expect(query()).toBe('')
  })
})

describe('browser history', () => {
  test('Back restores the previous view and Forward the next, without writing new entries', async () => {
    stopSync = startUrlSync()
    act(() => store().selectNode('app_index'))
    act(() => store().selectNode('os'))
    const entries = window.history.length
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')

    window.history.back()
    await settle()
    expect(query()).toBe('?node=app_index')
    expect(store().selectedNodeId).toBe('app_index')

    window.history.forward()
    await settle()
    expect(query()).toBe('?node=os')
    expect(store().selectedNodeId).toBe('os')

    // No loop: restoring from the URL wrote nothing back.
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.history.length).toBe(entries)
  })

  test('Back to the entry before any selection clears the view', async () => {
    stopSync = startUrlSync()
    act(() => store().selectNode('os'))
    act(() => store().setFilters({ hideThirdParty: false }))

    window.history.back()
    await settle()

    expect(query()).toBe('')
    expect(snapshotView(store())).toEqual(DEFAULT_VIEW_STATE)
  })

  test('the internal node history is its own list: browser Back adds to it, never rewrites it', async () => {
    stopSync = startUrlSync()
    act(() => store().selectNode('app_index'))
    act(() => store().selectNode('os'))

    window.history.back()
    await settle()

    expect(store().history).toEqual(['app_index', 'os', 'app_index'])
    expect(store().historyIndex).toBe(2)
  })

  test('internal Back and Forward are navigation for the browser, and keep working', () => {
    stopSync = startUrlSync()
    act(() => store().selectNode('app_index'))
    act(() => store().selectNode('os'))
    const entries = window.history.length

    act(() => store().goBack())
    expect(store()).toMatchObject({ selectedNodeId: 'app_index', history: ['app_index', 'os'], historyIndex: 0 })
    expect(query()).toBe('?node=app_index')

    act(() => store().goForward())
    expect(store()).toMatchObject({ selectedNodeId: 'os', historyIndex: 1 })
    expect(query()).toBe('?node=os')
    expect(window.history.length).toBe(entries + 2)
  })

  test('the URL written for a view decodes back to that view', () => {
    stopSync = startUrlSync()
    act(() => store().setFilters({ hideIsolated: true }))
    act(() => store().setCommunityCollapsed(3, true))
    act(() => store().selectNode('app_index_main'))

    expect(decodeViewState(query(), { model, index })).toEqual(snapshotView(store()))
  })
})

describe('share', () => {
  function useClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    })
  }

  test('the link is the origin plus the encoded view, even before the camera has settled', () => {
    store().selectNode('os')
    store().setCamera({ x: 0.25, y: 0.5, ratio: 0.5, angle: 0 })

    expect(currentViewUrl()).toBe(`${window.location.origin}/?node=os&cam=0.25%2C0.5%2C0.5`)
  })

  test('copies the link and says so in text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    useClipboard(writeText)
    store().selectNode('os')
    render(<ShareButton />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }))
    })

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?node=os`)
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Link copied to the clipboard')
  })

  test('the confirmation goes away by itself', async () => {
    vi.useFakeTimers()
    useClipboard(vi.fn().mockResolvedValue(undefined))
    render(<ShareButton />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }))
    })

    act(() => void vi.advanceTimersByTime(3000))

    expect(screen.getByRole('button', { name: 'Copy link to this view' })).toBeDefined()
  })

  test('without a clipboard the link is shown, selected, to copy by hand', async () => {
    useClipboard(undefined)
    store().selectCommunity(2)
    render(<ShareButton />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }))
    })

    const field = screen.getByLabelText('Copy this link') as HTMLInputElement
    expect(field.value).toBe(`${window.location.origin}/?community=2`)
    expect(field.readOnly).toBe(true)
    expect(field.selectionEnd).toBe(field.value.length)
    expect(screen.getByRole('status').textContent).toContain('Could not copy automatically')
  })

  test('a refused clipboard falls back the same way, and the fallback can be closed', async () => {
    useClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    render(<ShareButton />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }))
    })
    expect(screen.getByLabelText('Copy this link')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close the link' }))
    expect(screen.queryByLabelText('Copy this link')).toBeNull()
  })
})

describe('restored camera in the world', () => {
  function World() {
    const rendererRef = useRef<GraphRenderer | null>(null)
    return <GraphWorld model={model} index={index} graph={graph} positions={positions} rendererRef={rendererRef} />
  }

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    fake.focusNode.mockClear()
    fake.frameNodes.mockClear()
    fake.setCamera.mockClear()
  })

  test('a linked camera is applied once and the node is not refocused', () => {
    store().restoreView(view({ nodeId: 'os', camera: { x: 0.2, y: 0.3, ratio: 0.5 } }))

    render(<World />)

    expect(fake.setCamera).toHaveBeenCalledOnce()
    expect(fake.setCamera).toHaveBeenCalledWith({ x: 0.2, y: 0.3, ratio: 0.5 })
    expect(fake.focusNode).not.toHaveBeenCalled()
    expect(store().cameraRequest).toBeNull()
  })

  test('without a linked camera the restored node is focused as usual', () => {
    store().restoreView(view({ nodeId: 'os' }))

    render(<World />)

    expect(fake.focusNode).toHaveBeenCalledWith('os')
    expect(fake.setCamera).not.toHaveBeenCalled()
  })

  test('a linked camera wins over the framing of a restored expansion', () => {
    store().restoreView(view({ nodeId: 'app_index_main', expansionDepth: 1, camera: { x: 0.4, y: 0.4, ratio: 0.3 } }))

    render(<World />)

    expect(fake.frameNodes).not.toHaveBeenCalled()
    expect(fake.setCamera).toHaveBeenCalledWith({ x: 0.4, y: 0.4, ratio: 0.3 })
  })

  test('the camera waits for nodes that still have no position', () => {
    const partial = new Map([...positions].filter(([id]) => id !== 'app_lib_xlsx_min_s'))
    useAppStore.setState({ data: { status: 'ready', model, index, search: buildSearchIndex(model), graph, positions: partial } })
    // ensurePositions would start the layout worker, which jsdom does not have.
    useAppStore.setState({ isLayoutRunning: true })
    store().restoreView(view({ showThirdParty: true, camera: { x: 0.2, y: 0.3, ratio: 0.5 } }))
    function PartialWorld() {
      const rendererRef = useRef<GraphRenderer | null>(null)
      const current = useAppStore((state) => (state.data.status === 'ready' ? state.data.positions : partial))
      return <GraphWorld model={model} index={index} graph={graph} positions={current} rendererRef={rendererRef} />
    }
    render(<PartialWorld />)
    expect(fake.setCamera).not.toHaveBeenCalled()

    act(() =>
      useAppStore.setState({ data: { status: 'ready', model, index, search: buildSearchIndex(model), graph, positions } }),
    )

    expect(fake.setCamera).toHaveBeenCalledWith({ x: 0.2, y: 0.3, ratio: 0.5 })
  })

  test('the renderer reports the camera to the store, where the URL reads it', () => {
    render(<World />)

    act(() => fake.events.onCameraChange?.({ x: 0.1, y: 0.9, ratio: 0.25, angle: 0 }))

    expect(store().camera).toEqual({ x: 0.1, y: 0.9, ratio: 0.25 })
  })
})
