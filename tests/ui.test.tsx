// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { ExplorerPanel } from '@/features/explorer/ExplorerPanel'
import { listCommunities, listFolders, listProjects } from '@/features/explorer/explorer-data'
import { ErrorScreen, LoadingScreen } from '@/features/hud/BootScreen'
import { GraphControls } from '@/features/hud/GraphControls'
import { InspectorPanel } from '@/features/inspector/InspectorPanel'
import { GraphCommandsContext, type GraphCommands } from '@/features/world/graph-commands'
import { buildGraph, buildGraphIndex, DEFAULT_FILTERS } from '@/graph'
import { useAppStore } from '@/state/store'
import { HudButton, Section, Switch } from '@/ui/primitives'
import { keepOneSheetOnPhones, MOBILE_QUERY } from '@/ui/responsive'
import { makeRawGraph } from './fixtures'

const model = adaptGraphify(makeRawGraph())
const index = buildGraphIndex(model)
const graph = buildGraph(model)
const initialState = useAppStore.getState()

function renderWithCommands(ui: React.ReactNode) {
  const commands: GraphCommands = {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetCamera: vi.fn(),
    focusNode: vi.fn(),
    expandNode: vi.fn(),
    focusCommunity: vi.fn(),
  }
  render(<GraphCommandsContext.Provider value={commands}>{ui}</GraphCommandsContext.Provider>)
  return commands
}

beforeEach(() => {
  useAppStore.setState({ ...initialState, filters: DEFAULT_FILTERS }, true)
})

afterEach(cleanup)

describe('primitives', () => {
  test('HudButton exposes its label as the accessible name and tooltip', () => {
    const onClick = vi.fn()
    render(<HudButton label="Zoom in" onClick={onClick}>+</HudButton>)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))

    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByText('Zoom in')).toHaveProperty('ariaHidden', 'true')
  })

  test('Switch reports and toggles its state', () => {
    const onChange = vi.fn()
    render(<Switch label="Relations" checked={false} onChange={onChange} />)
    const control = screen.getByRole('switch', { name: /Relations/ })

    fireEvent.click(control)

    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('Section collapses and expands its content', () => {
    render(<Section title="Projects"><p>content</p></Section>)
    const toggle = screen.getByRole('button', { name: /Projects/ })

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('content').parentElement?.hidden).toBe(true)
  })
})

describe('InspectorPanel', () => {
  test('shows the empty state when nothing is selected', () => {
    renderWithCommands(<InspectorPanel model={model} index={index} graph={graph} />)

    expect(screen.getByText('No node selected')).toBeDefined()
    expect(screen.getByText('Select a node in the graph, or press / to search.')).toBeDefined()
  })

  test('shows the selected node from the store', () => {
    useAppStore.getState().selectNode('app_lib_xlsx_min_s')
    renderWithCommands(<InspectorPanel model={model} index={index} graph={graph} />)
    const panel = within(screen.getByRole('region', { name: 'Node inspector' }))

    expect(panel.getByText('s()')).toBeDefined()
    expect(panel.getByText('app/public/lib/xlsx.full.min.js')).toBeDefined()
    expect(panel.getAllByText('Community 1').length).toBeGreaterThan(0)
    expect(panel.getByText('Third-party code')).toBeDefined()
    expect(panel.getByText('Callable')).toBeDefined()
  })

  test('focus and clear act on the selected node', () => {
    useAppStore.getState().selectNode('os')
    const commands = renderWithCommands(
      <InspectorPanel model={model} index={index} graph={graph} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Focus this node' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(commands.focusNode).toHaveBeenCalledWith('os')
    expect(useAppStore.getState().selectedNodeId).toBeNull()
  })

  test('collapsing makes the panel inert', () => {
    renderWithCommands(<InspectorPanel model={model} index={index} graph={graph} />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }))

    expect(useAppStore.getState().panels.inspector).toBe(false)
    expect(document.querySelector('.eog-inspector')?.getAttribute('data-open')).toBe('false')
  })
})

describe('store', () => {
  test('selecting a node reopens a collapsed inspector', () => {
    useAppStore.getState().setPanel('inspector', false)

    useAppStore.getState().selectNode('os')

    expect(useAppStore.getState().panels.inspector).toBe(true)
  })
})

describe('ExplorerPanel', () => {
  test('lists projects and marks the active one', () => {
    render(<ExplorerPanel model={model} index={index} />)
    const project = screen.getByRole('button', { name: /^app/ })

    expect(screen.getByText('No project selected')).toBeDefined()
    fireEvent.click(project)

    expect(project.getAttribute('aria-pressed')).toBe('true')
    expect(useAppStore.getState().activeProject).toBe('app')
    expect(screen.getByText('src')).toBeDefined()
  })

  test('the third-party switch drives the existing filter', () => {
    render(<ExplorerPanel model={model} index={index} />)

    fireEvent.click(screen.getByRole('switch', { name: /Third-party code/ }))

    expect(useAppStore.getState().filters.hideThirdParty).toBe(false)
  })

  test('selecting a community sets the active community', () => {
    render(<ExplorerPanel model={model} index={index} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show only Community 0' }))

    expect(useAppStore.getState().activeCommunity).toBe(0)
  })
})

describe('explorer data', () => {
  test('counts nodes per project, largest first', () => {
    expect(listProjects(model.nodes)).toEqual([
      { name: 'app', count: 3 },
      { name: '', count: 2 },
      { name: 'mhd-aplicación', count: 1 },
    ])
  })

  test('lists the first-level folders of a project', () => {
    expect(listFolders(model.nodes, 'app')).toEqual([
      { name: 'src', count: 2 },
      { name: 'public', count: 1 },
    ])
  })

  test('hides communities made only of third-party code while it is filtered out', () => {
    const hidden = listCommunities(model.communities, true, 10)
    const shown = listCommunities(model.communities, false, 10)

    expect(hidden.rows.map((row) => row.community.id)).toEqual([0, 2, 3])
    expect(shown.total).toBe(4)
    expect(listCommunities(model.communities, false, 2).rows).toHaveLength(2)
  })
})

describe('GraphControls', () => {
  test('sends camera commands and disables focus without a selection', () => {
    const commands = renderWithCommands(<GraphControls />)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))

    expect(commands.zoomIn).toHaveBeenCalledOnce()
    expect(commands.resetCamera).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /Focus/ })).toHaveProperty('disabled', true)
  })

  test('view toggles both panels at once', () => {
    renderWithCommands(<GraphControls />)

    fireEvent.click(screen.getByRole('button', { name: /Hide panels/ }))

    expect(useAppStore.getState().panels).toEqual({ explorer: false, inspector: false })
    expect(screen.getByRole('button', { name: 'Show panels' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('boot screens', () => {
  test('loading names the stage in progress', () => {
    render(<LoadingScreen stage="adapting" />)

    expect(screen.getByText('System initializing')).toBeDefined()
    expect(screen.getByText('Loading knowledge structure').getAttribute('data-state')).toBe('active')
    expect(screen.getByText('Graph core online').getAttribute('data-state')).toBe('done')
  })

  test('error shows a readable message, never a stack trace', () => {
    const onRetry = vi.fn()
    render(
      <ErrorScreen
        message={'graph.json does not match the expected Graphify schema:\n    at adapt (adapter.ts:1)'}
        issues={[{ path: 'nodes[].id', message: 'Required', count: 3, example: 'nodes[0].id' }]}
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load the graph again' }))

    expect(screen.getByRole('alert').textContent).toContain('Graph core error')
    expect(screen.getByRole('alert').textContent).not.toContain('adapter.ts')
    expect(screen.getByText(/nodes\[\]\.id/)).toBeDefined()
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('panels on a phone', () => {
  function onScreen(width: number): () => void {
    const original = window.matchMedia
    window.matchMedia = vi.fn((query: string) => ({ matches: query === MOBILE_QUERY && width <= 720 })) as never
    const unsubscribe = useAppStore.subscribe(keepOneSheetOnPhones)
    return () => {
      unsubscribe()
      window.matchMedia = original
    }
  }

  test('the panel that opens replaces the one that was open: they share one bottom sheet', () => {
    const stop = onScreen(390)
    useAppStore.getState().setPanel('inspector', false)

    useAppStore.getState().setPanel('explorer', true)
    expect(useAppStore.getState().panels).toEqual({ explorer: true, inspector: false })

    // Picking a node opens the inspector, which takes the sheet.
    useAppStore.setState({ data: { status: 'ready', model, index, search: { search: vi.fn() } as never, graph, positions: new Map() } })
    useAppStore.getState().selectNode('app_index')
    expect(useAppStore.getState().panels).toEqual({ explorer: false, inspector: true })

    useAppStore.getState().setPanel('explorer', true)
    expect(useAppStore.getState().panels).toEqual({ explorer: true, inspector: false })
    stop()
  })

  test('wider screens keep both panels open', () => {
    const stop = onScreen(1024)

    useAppStore.getState().setPanel('explorer', true)
    useAppStore.getState().setPanel('inspector', true)

    expect(useAppStore.getState().panels).toEqual({ explorer: true, inspector: true })
    stop()
  })
})
