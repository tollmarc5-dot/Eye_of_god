// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { InspectorPanel } from '@/features/inspector/InspectorPanel'
import { GraphCommandsContext, type GraphCommands } from '@/features/world/graph-commands'
import {
  analyzeNode,
  buildGraph,
  buildGraphIndex,
  DEFAULT_FILTERS,
  filterConnections,
  sortConnections,
} from '@/graph'
import { buildSearchIndex } from '@/search'
import { useAppStore } from '@/state/store'
import { makeRawGraph } from './fixtures'

/**
 * The fixture plus a hub with enough relations to exercise grouping, sorting
 * and paging: 30 nodes call `hub`, and `hub` references three of them back.
 */
function makeHubGraph() {
  const raw = makeRawGraph()
  const template = raw.links[0]
  if (!template) throw new Error('fixture has no links')
  const callers = Array.from({ length: 30 }, (_value, order) => ({
    id: `caller_${String(order).padStart(2, '0')}`,
    label: `caller${String(order).padStart(2, '0')}()`,
    norm_label: `caller${order}()`,
    community: order < 20 ? 0 : 2,
    file_type: 'code',
    source_file: 'app/src/callers.js',
    source_location: `L${order + 1}`,
    _origin: 'ast',
  }))
  const hub = {
    id: 'hub',
    label: 'hub()',
    norm_label: 'hub()',
    community: 0,
    file_type: 'code',
    source_file: 'app/src/core/hub.js',
    source_location: 'L1',
    _origin: 'ast',
    rationale: 'Central dispatcher <b>not markup</b>',
  }
  return {
    ...raw,
    nodes: [...raw.nodes, hub, ...callers],
    links: [
      ...raw.links,
      ...callers.map((caller) => ({ ...template, source: caller.id, target: 'hub', relation: 'calls' })),
      ...callers.slice(0, 3).map((caller) => ({
        ...template,
        source: 'hub',
        target: caller.id,
        relation: 'references',
        confidence: 'INFERRED',
      })),
      { ...template, source: 'hub', target: 'app_lib_xlsx_min_s', relation: 'calls' },
    ],
  }
}

const model = adaptGraphify(makeHubGraph())
const index = buildGraphIndex(model)
const graph = buildGraph(model)
const initialState = useAppStore.getState()
const analysisOf = (nodeId: string) => {
  const analysis = analyzeNode(graph, index, nodeId)
  if (!analysis) throw new Error(`no analysis for ${nodeId}`)
  return analysis
}

describe('analyzeNode', () => {
  test('separates incoming from outgoing by the real edge direction', () => {
    const analysis = analysisOf('app_index_main')
    const describeConnection = (direction: string) =>
      analysis.connections
        .filter((connection) => connection.direction === direction)
        .map((connection) => `${connection.edge.relation}:${connection.node.id}`)
        .sort()

    expect(describeConnection('incoming')).toEqual(['contains:app_index'])
    expect(describeConnection('outgoing')).toEqual(['calls:app_lib_xlsx_min_s', 'imports:os'])
    expect(describeConnection('self')).toEqual(['calls:app_index_main'])
  })

  test('groups relations by type, most frequent first, using the types in the data', () => {
    const analysis = analysisOf('hub')

    expect(analysis.incoming).toEqual([{ relation: 'calls', count: 30 }])
    expect(analysis.outgoing).toEqual([
      { relation: 'references', count: 3 },
      { relation: 'calls', count: 1 },
    ])
    expect(analysis.incomingCount).toBe(30)
    expect(analysis.outgoingCount).toBe(4)
  })

  test('metrics agree with graphology and with the model degrees', () => {
    for (const nodeId of ['hub', 'app_index_main', 'lonely', 'os']) {
      const analysis = analysisOf(nodeId)
      const node = index.nodeById.get(nodeId)

      expect(node?.inDegree).toBe(graph.inDegree(nodeId))
      expect(node?.outDegree).toBe(graph.outDegree(nodeId))
      expect(node?.degree).toBe(graph.degree(nodeId))
      expect(analysis.incomingCount + analysis.selfCount).toBe(graph.inDegree(nodeId))
      expect(analysis.outgoingCount + analysis.selfCount).toBe(graph.outDegree(nodeId))
      expect(analysis.neighborCount).toBe(graph.neighbors(nodeId).filter((id) => id !== nodeId).length)
    }
  })

  test('neighbours are distinct nodes; relations are edges', () => {
    const analysis = analysisOf('hub')

    // 30 callers + xlsx; three callers are connected by two relations each.
    expect(analysis.neighborCount).toBe(31)
    expect(analysis.relationCount).toBe(34)
  })

  test('a self-reference is one relation and no neighbour', () => {
    const analysis = analysisOf('app_index_main')

    expect(analysis.selfCount).toBe(1)
    expect(analysis.relationCount).toBe(4)
    expect(analysis.neighborCount).toBe(3)
  })

  test('an isolated node has no relationships, an unknown id no analysis', () => {
    expect(analysisOf('lonely')).toMatchObject({ relationCount: 0, neighborCount: 0, connections: [] })
    expect(analyzeNode(graph, index, 'ghost')).toBeNull()
  })

  test('sorting is deterministic and does not touch the analysis', () => {
    const { connections } = analysisOf('hub')
    const before = [...connections]

    const byRelation = sortConnections(connections, 'relation')
    const byName = sortConnections(connections, 'name')
    const byDegree = sortConnections(connections, 'degree')

    expect(connections).toEqual(before)
    expect(byRelation.slice(0, 2).map((connection) => connection.direction)).toEqual(['incoming', 'incoming'])
    expect(byRelation.at(-1)?.edge.relation).toBe('references')
    expect(byName[0]?.node.label).toBe('caller00()')
    // caller00..02 have two relations with the hub, so the highest degree.
    expect(byDegree[0]?.node.degree).toBe(2)
    expect(sortConnections(connections, 'degree')).toEqual(byDegree)
  })

  test('filtering keeps one direction and one relation type', () => {
    const { connections } = analysisOf('hub')

    expect(filterConnections(connections, { direction: 'outgoing', relation: 'references' })).toHaveLength(3)
    expect(filterConnections(connections, { direction: 'incoming', relation: 'references' })).toHaveLength(0)
    expect(filterConnections(connections, null)).toBe(connections)
  })
})

describe('advanced inspector', () => {
  let commands: GraphCommands
  const store = () => useAppStore.getState()
  const panel = () => within(screen.getByRole('region', { name: 'Node inspector' }))
  const fieldValue = (label: string) =>
    panel().getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

  function open(nodeId: string) {
    useAppStore.setState({ selectedNodeId: nodeId })
    commands = { zoomIn: vi.fn(), zoomOut: vi.fn(), resetCamera: vi.fn(), focusNode: vi.fn(), expandNode: vi.fn(), focusCommunity: vi.fn() }
    render(
      <GraphCommandsContext.Provider value={commands}>
        <InspectorPanel model={model} index={index} graph={graph} />
      </GraphCommandsContext.Provider>,
    )
  }

  beforeEach(() => {
    useAppStore.setState(
      {
        ...initialState,
        filters: DEFAULT_FILTERS,
        data: { status: 'ready', model, index, search: buildSearchIndex(model), graph, positions: new Map() },
      },
      true,
    )
  })

  afterEach(cleanup)

  test('the node is named in a pinned header, apart from the scrolling details', () => {
    open('hub')

    const identity = panel().getByText('hub()', { selector: '.eog-node__name' }).closest('.eog-node-identity')
    expect(identity).not.toBeNull()
    // Not inside the summary: a sticky header only stays pinned while its own block is on screen.
    expect(identity?.closest('.eog-node')).toBeNull()
    expect(identity?.parentElement?.classList.contains('eog-panel__body')).toBe(true)
  })

  test('a new selection starts at the top of the inspector, with the new node named', () => {
    open('hub')
    const body = screen.getByRole('region', { name: 'Node inspector' }).querySelector('.eog-panel__body')
    if (!body) throw new Error('inspector body not found')
    body.scrollTop = 480

    act(() => useAppStore.setState({ selectedNodeId: 'caller_01' }))

    expect(body.scrollTop).toBe(0)
    expect(panel().getByText(/caller/, { selector: '.eog-node__name' })).toBeDefined()
  })

  test('shows the real metadata of the node', () => {
    open('hub')

    expect(panel().getByText('hub()', { selector: '.eog-node__name' })).toBeDefined()
    expect(fieldValue('Type')).toBe('code')
    expect(fieldValue('File')).toBe('app/src/core/hub.js · L1')
    expect(fieldValue('Project')).toBe('app')
    expect(fieldValue('Folder')).toBe('src/core')
    expect(fieldValue('Community')).toBe('Community 0Open community')
    expect(fieldValue('Origin')).toBe('Project code · extracted by ast')
  })

  test('renders the rationale as text, never as markup', () => {
    open('hub')

    expect(panel().getByText('Central dispatcher <b>not markup</b>')).toBeDefined()
    expect(document.querySelector('.eog-node__note b')).toBeNull()
  })

  test('does not invent fields: an external node has no folder and says so for the file', () => {
    open('os')

    expect(fieldValue('File')).toBe('No source file')
    expect(panel().queryByText('Folder', { selector: 'dt' })).toBeNull()
    expect(fieldValue('Project')).toBe('(root / external)')
    expect(fieldValue('Origin')).toBe('Project code')
  })

  test('shows degree, incoming, outgoing and distinct neighbours', () => {
    open('hub')

    expect(fieldValue('Degree')).toBe('34')
    expect(fieldValue('Incoming')).toBe('30')
    expect(fieldValue('Outgoing')).toBe('4')
    expect(fieldValue('Neighbours')).toBe('31')
    expect(panel().getByText(/34 relations/)).toBeDefined()
  })

  test('explains why degree and relations differ when the node references itself', () => {
    open('app_index_main')

    expect(fieldValue('Degree')).toBe('5')
    expect(panel().getByText(/4 relations · 1 self-reference \(counted in and out\)/)).toBeDefined()
  })

  test('lists relationship types by direction with their counts', () => {
    open('hub')

    expect(panel().getByRole('button', { name: /^Incoming calls: 30/ })).toBeDefined()
    expect(panel().getByRole('button', { name: /^Outgoing references: 3/ })).toBeDefined()
    expect(panel().getByRole('button', { name: /^Outgoing calls: 1/ })).toBeDefined()
    expect(panel().queryByRole('button', { name: /^Incoming references/ })).toBeNull()
  })

  test('says "None" for a direction without relations', () => {
    open('app_index')

    expect(panel().getByText('None')).toBeDefined()
    expect(panel().getByRole('button', { name: /^Outgoing contains: 1/ })).toBeDefined()
  })

  test('connected nodes carry direction, relation, type and community', () => {
    open('app_index_main')

    const incoming = panel().getByRole('button', { name: 'Incoming from index.js, contains. Inspect' })
    expect(incoming.textContent).toContain('code')
    expect(incoming.textContent).toContain('Community 0')
    expect(panel().getByRole('button', { name: 'Outgoing to os, imports. Inspect' }).textContent).toContain('concept')
    // The self-reference is listed but is not a navigation target.
    expect(panel().getByRole('listitem', { name: 'Self-reference, calls' })).toBeDefined()
  })

  test('flags relations that Graphify inferred instead of extracting', () => {
    open('hub')
    fireEvent.click(panel().getByRole('button', { name: /^Outgoing references/ }))

    const rows = panel().getAllByRole('button', { name: /^Outgoing to caller/ })
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('INFERRED')
  })

  test('a long list starts with one page and grows on demand', () => {
    open('hub')
    const connectionRows = () => panel().getAllByRole('button', { name: /Inspect$/ })

    expect(connectionRows()).toHaveLength(25)
    fireEvent.click(panel().getByRole('button', { name: 'Show 9 more (9 left)' }))

    expect(connectionRows()).toHaveLength(34)
    expect(panel().queryByRole('button', { name: /^Show \d+ more/ })).toBeNull()
  })

  test('a relationship row narrows the list; pressing it again or Escape restores it', () => {
    open('hub')
    const row = panel().getByRole('button', { name: /^Outgoing references/ })

    fireEvent.click(row)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(panel().getAllByRole('button', { name: /Inspect$/ })).toHaveLength(3)

    fireEvent.keyDown(row, { key: 'Escape' })
    expect(row.getAttribute('aria-pressed')).toBe('false')
    expect(panel().getAllByRole('button', { name: /Inspect$/ })).toHaveLength(25)
  })

  test('sorting by name and by degree reorders the same rows', () => {
    open('hub')
    const firstRow = () => panel().getAllByRole('button', { name: /Inspect$/ })[0]?.getAttribute('aria-label')

    fireEvent.click(panel().getByRole('button', { name: 'Name' }))
    expect(firstRow()).toBe('Incoming from caller00(), calls. Inspect')
    expect(panel().getByRole('button', { name: 'Name' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(panel().getByRole('button', { name: 'Degree' }))
    expect(firstRow()).toMatch(/caller0[012]\(\)/)
  })

  test('offers no sorting for a handful of connections', () => {
    open('app_index_main')

    expect(panel().queryByRole('group', { name: 'Sort connected nodes by' })).toBeNull()
  })

  test('an isolated node explains itself and cannot be expanded', () => {
    open('lonely')

    expect(panel().getByText('No relationships')).toBeDefined()
    expect(panel().getByRole('button', { name: /^Expand to depth 1/ })).toHaveProperty('disabled', true)
    expect(panel().getByRole('button', { name: 'Focus this node' })).toHaveProperty('disabled', false)
  })

  test('opening a connected node goes through the store and asks for focus', () => {
    open('app_index_main')

    fireEvent.click(panel().getByRole('button', { name: 'Outgoing to os, imports. Inspect' }))

    expect(store().selectedNodeId).toBe('os')
    expect(store().focusRequest).toBe('os')
    expect(store().history).toEqual(['os'])
    expect(panel().getByText('os', { selector: '.eog-node__name' })).toBeDefined()
    expect(fieldValue('Incoming')).toBe('1')
  })

  test('list controls reset when the inspected node changes', () => {
    open('hub')
    fireEvent.click(panel().getByRole('button', { name: /^Outgoing references/ }))

    fireEvent.click(panel().getAllByRole('button', { name: /^Outgoing to caller/ })[0] as HTMLElement)

    expect(store().selectedNodeId).toMatch(/^caller_0[012]$/)
    expect(panel().getAllByRole('button', { name: /Inspect$/ })).toHaveLength(2)
  })

  test('focus, expand and clear use the existing camera commands and selection', () => {
    open('hub')

    fireEvent.click(panel().getByRole('button', { name: 'Focus this node' }))
    fireEvent.click(panel().getByRole('button', { name: /^Expand to depth 1/ }))
    expect(commands.focusNode).toHaveBeenCalledWith('hub')
    expect(commands.expandNode).toHaveBeenCalledWith('hub', 1)
    expect(store().selectedNodeId).toBe('hub')

    fireEvent.click(panel().getByRole('button', { name: 'Clear selection' }))
    expect(store().selectedNodeId).toBeNull()
    expect(panel().getByText('No node selected')).toBeDefined()
  })

  test('a neighbour hidden by the filters is flagged, and counted', () => {
    open('hub')
    fireEvent.click(panel().getByRole('button', { name: /^Outgoing calls/ }))

    const hidden = panel().getByRole('button', { name: /^Outgoing to s\(\), calls, outside the current view/ })
    expect(hidden.textContent).toContain('Outside view')
    expect(panel().getByText(/1 neighbour outside the current view/)).toBeDefined()
  })

  test('opening a hidden neighbour reveals it instead of selecting something invisible', () => {
    open('hub')
    fireEvent.click(panel().getByRole('button', { name: /^Outgoing calls/ }))

    fireEvent.click(panel().getByRole('button', { name: /^Outgoing to s\(\)/ }))

    expect(store().selectedNodeId).toBe('app_lib_xlsx_min_s')
    expect(store().filters.hideThirdParty).toBe(false)
    expect(fieldValue('Origin')).toBe('Third-party code')
  })

  test('the hidden count follows the active scope', () => {
    useAppStore.setState({ activeCommunity: 0 })
    open('hub')

    // 10 callers live in community 2, plus the third-party node.
    expect(panel().getByText(/11 neighbours outside the current view/)).toBeDefined()
  })

  test('a scope that hides the inspected node empties the inspector', () => {
    open('hub')

    fireEvent.click(panel().getByRole('button', { name: 'Collapse inspector' }))
    store().setActiveCommunity(2)
    cleanup()
    render(<InspectorPanel model={model} index={index} graph={graph} />)

    expect(store().selectedNodeId).toBeNull()
    expect(panel().getByText('No node selected')).toBeDefined()
  })

  test('a selection that is not in the graph is reported, with a way out', () => {
    open('ghost')

    expect(screen.getByRole('alert').textContent).toContain('Node not available')
    fireEvent.click(panel().getByRole('button', { name: 'Clear selection' }))
    expect(store().selectedNodeId).toBeNull()
  })

  test('says so while the node is still waiting for its position', () => {
    useAppStore.setState({ focusRequest: 'hub' })
    open('hub')

    expect(panel().getByRole('status').textContent).toBe('Positioning node in the graph…')
  })

  test('connected nodes are real buttons that the arrow keys walk', () => {
    open('app_index_main')
    const first = panel().getByRole('button', { name: /^Incoming from index\.js/ })
    const second = panel().getByRole('button', { name: /^Outgoing to s\(\)/ })
    expect(first.tabIndex).toBe(0)
    first.focus()

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)

    fireEvent.keyDown(second, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
  })
})
