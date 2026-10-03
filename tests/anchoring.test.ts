import { readFileSync } from 'node:fs'
import { resolveGraphSource } from '../scripts/graph-source.mjs'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import {
  buildGraph,
  buildGraphIndex,
  computeAggregates,
  computeVisibleNodeIds,
  DEFAULT_FILTERS,
  summarizeCommunities,
  withCommunityCollapsed,
  type Aggregation,
  type GraphIndex,
  type KnowledgeGraph,
} from '@/graph'
import { anchoredDisplay, drawnEdgeEnds, drawnEndOf, isEdgeDrawn } from '@/renderer/anchoring'
import { createMotionUniforms } from '@/renderer/motion'
import { createFlowEdgeProgram } from '@/renderer/programs/flow-edge'
import { computeFocus, createReducers, EMPTY_VIEW_STATE, type RendererViewState } from '@/renderer/reducers'
import type { GraphModel } from '@/types/graph'

// The program base class touches WebGL as soon as it is imported; its own logic does not.
vi.mock('sigma/rendering', () => ({ EdgeProgram: class {}, NodeProgram: class {} }))
vi.mock('sigma/utils', () => ({ floatColor: () => 0 }))

/** Contract test against the real Graphify output (read-only). */
// Graphify's output where it exists, the versioned snapshot elsewhere (CI, other computers).
const GRAPH_PATH = resolveGraphSource().path
const COMMUNITY_VIEW: Aggregation = { mode: 'communities', exceptions: [] }

let model: GraphModel
let index: GraphIndex
let graph: KnowledgeGraph
/** Every node, third-party code included: the only view where communities are linked. */
let everything: ReadonlySet<string>

const communityOf = (nodeId: string): number | null => graph.getNodeAttribute(nodeId, 'community')

function viewFor(aggregation: Aggregation, visible: ReadonlySet<string> = everything): RendererViewState {
  return {
    ...EMPTY_VIEW_STATE,
    visibleNodeIds: visible,
    aggregates: computeAggregates(graph, model, index, aggregation, visible),
  }
}

/** Every relation of the graph → the two nodes it is drawn between ('' when it is not drawn). */
function picture(view: RendererViewState): Map<string, string> {
  const ends = new Map<string, string>()
  graph.forEachEdge((edgeId) => ends.set(edgeId, drawnEdgeEnds(graph, view, edgeId)?.join(' → ') ?? ''))
  return ends
}

beforeAll(() => {
  model = adaptGraphify(JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')))
  index = buildGraphIndex(model)
  graph = buildGraph(model)
  everything = computeVisibleNodeIds(model, { ...DEFAULT_FILTERS, hideThirdParty: false })
})

describe('relations of collapsed communities (real graph)', () => {
  test('every drawn relation joins the aggregates of the two communities it really connects', () => {
    const view = viewFor(COMMUNITY_VIEW)
    let drawn = 0
    graph.forEachEdge((edgeId, _attributes, source, target) => {
      const ends = drawnEdgeEnds(graph, view, edgeId)
      if (ends === null) {
        // Only relations folded inside one community disappear.
        expect(communityOf(source), edgeId).toBe(communityOf(target))
        return
      }
      drawn += 1
      expect(ends).toEqual([
        view.aggregates?.get(communityOf(source) ?? -1)?.representativeId,
        view.aggregates?.get(communityOf(target) ?? -1)?.representativeId,
      ])
    })
    expect(drawn).toBeGreaterThan(0)
  })

  test('no false connection: the community pairs drawn are exactly those that share real relations', () => {
    const view = viewFor(COMMUNITY_VIEW)
    const drawnPairs = new Set<string>()
    graph.forEachEdge((edgeId) => {
      const ends = drawnEdgeEnds(graph, view, edgeId)
      if (!ends) return
      const [a, b] = ends.map((nodeId) => communityOf(nodeId) ?? -1).sort((x, y) => x - y)
      drawnPairs.add(`${a}-${b}`)
    })
    const realPairs = new Set<string>()
    for (const [communityId, summary] of summarizeCommunities(model, index, everything)) {
      for (const other of summary.neighbors.keys()) {
        realPairs.add(`${Math.min(communityId, other)}-${Math.max(communityId, other)}`)
      }
    }
    expect(drawnPairs.size).toBeGreaterThan(0)
    expect([...drawnPairs].sort()).toEqual([...realPairs].sort())
  })

  test('with the default filters nothing is drawn between communities, because no first-party relation crosses one', () => {
    const firstParty = computeVisibleNodeIds(model, DEFAULT_FILTERS)
    const view = viewFor(COMMUNITY_VIEW, firstParty)

    expect([...picture(view).values()].filter(Boolean)).toEqual([])
  })

  test('expanding one community draws its members again; every other end stays on its aggregate', () => {
    const view = viewFor(COMMUNITY_VIEW)
    const connected = [...summarizeCommunities(model, index, everything).values()]
      .filter((summary) => summary.externalEdgeCount > 0)
      .sort((a, b) => b.externalEdgeCount - a.externalEdgeCount || a.communityId - b.communityId)[0]
    if (!connected) throw new Error('the real graph has relations between communities')
    const expanded = viewFor(withCommunityCollapsed(COMMUNITY_VIEW, connected.communityId, false))

    let touching = 0
    graph.forEachEdge((edgeId, _attributes, source, target) => {
      const ends = drawnEdgeEnds(graph, expanded, edgeId)
      const expectedEnd = (nodeId: string): string =>
        communityOf(nodeId) === connected.communityId ? nodeId : drawnEndOf(graph, view.aggregates, nodeId)
      if (communityOf(source) === connected.communityId || communityOf(target) === connected.communityId) {
        touching += 1
        expect(ends, edgeId).toEqual([expectedEnd(source), expectedEnd(target)])
      } else {
        expect(ends, edgeId).toEqual(drawnEdgeEnds(graph, view, edgeId))
      }
    })
    expect(touching).toBeGreaterThan(connected.externalEdgeCount)
  })

  test('collapsing it again gives back exactly the same picture', () => {
    const before = picture(viewFor(COMMUNITY_VIEW))
    const communityId = model.communities[0]?.id ?? 0
    const expanded = withCommunityCollapsed(COMMUNITY_VIEW, communityId, false)
    const collapsedAgain = withCommunityCollapsed(expanded, communityId, true)

    expect(picture(viewFor(expanded))).not.toEqual(before)
    expect(picture(viewFor(collapsedAgain))).toEqual(before)
  })

  test('the plain node view draws every relation between its own two ends', () => {
    const view = viewFor({ mode: 'nodes', exceptions: [] })
    graph.forEachEdge((edgeId, _attributes, source, target) => {
      expect(drawnEdgeEnds(graph, view, edgeId)).toEqual([source, target])
    })
  })

  test('hidden relation types and hidden relations are never drawn', () => {
    const view = { ...viewFor(COMMUNITY_VIEW), visibleRelations: new Set(['imports']) }
    graph.forEachEdge((edgeId, attributes) => {
      if (attributes.relation !== 'imports') expect(isEdgeDrawn(graph, view, edgeId)).toBe(false)
    })
    expect([...picture({ ...view, showEdges: false }).values()].filter(Boolean)).toEqual([])
  })
})

describe('selection and focus keep the model (real graph)', () => {
  test('reducers anchor members and hide relations exactly as the anchoring model says, whatever is selected or hovered', () => {
    const community = model.communities.find((candidate) => (index.nodeIdsByCommunity.get(candidate.id)?.length ?? 0) > 3)
    if (!community) throw new Error('the real graph has communities')
    const base = viewFor(withCommunityCollapsed(COMMUNITY_VIEW, community.id, false))
    const selected = index.nodeIdsByCommunity.get(community.id)?.[0] ?? null
    const hoveredAggregate = [...(base.aggregates?.values() ?? [])][0]?.representativeId ?? null

    const cases: [RendererViewState, string | null][] = [
      [{ ...base, selectedNodeId: selected }, null],
      [{ ...base, selectedNodeId: selected }, hoveredAggregate],
      [{ ...base, selectedCommunityId: community.id }, selected],
    ]
    for (const [view, hovered] of cases) {
      const focus = computeFocus(graph, view, hovered)
      const reducers = createReducers(graph, () => view, () => focus)
      graph.forEachNode((nodeId, attributes) => {
        const display = reducers.nodeReducer(nodeId, { ...attributes }) as { anchor?: string }
        const end = drawnEndOf(graph, view.aggregates, nodeId)
        expect(display.anchor ?? nodeId, nodeId).toBe(end)
      })
      graph.forEachEdge((edgeId, attributes) => {
        const display = reducers.edgeReducer(edgeId, { ...attributes }) as { hidden?: boolean }
        expect(display.hidden === true, edgeId).toBe(!isEdgeDrawn(graph, view, edgeId))
      })
    }
  })
})

describe('edge program input', () => {
  type Display = { x: number; y: number; size: number; color: string; community?: number | null; anchor?: string }
  const displays: Record<string, Display> = {
    representative: { x: 10, y: 20, size: 9, color: '#fff', community: 4 },
    member: { x: 99, y: 99, size: 0.001, color: '#fff', community: 4, anchor: 'representative' },
    outside: { x: 50, y: 60, size: 3, color: '#fff', community: 7 },
    orphan: { x: 1, y: 2, size: 3, color: '#fff', community: 8, anchor: 'not-drawn' },
  }

  function processEdge(source: Display, target: Display): number[] {
    const Program = createFlowEdgeProgram(createMotionUniforms({ amplitude: 0, glow: 1, ambientFlow: 0, focusFlow: 0 }), [0, 0, 0])
    // Only the part of the program that turns display data into vertex attributes.
    const program = Object.create(Program.prototype) as {
      array: Float32Array
      renderer: { getNodeDisplayData(nodeId: string): Display | undefined }
      processVisibleItem(edgeIndex: number, startIndex: number, ...data: unknown[]): void
    }
    program.array = new Float32Array(11)
    program.renderer = { getNodeDisplayData: (nodeId) => displays[nodeId] }
    program.processVisibleItem(0, 0, source, target, { size: 1, color: '#fff' })
    return [...program.array.slice(0, 4)]
  }

  test('an end inside a collapsed community is drawn on its representative', () => {
    expect(processEdge(displays.member!, displays.outside!)).toEqual([10, 20, 50, 60])
    expect(processEdge(displays.outside!, displays.member!)).toEqual([50, 60, 10, 20])
  })

  test('ends outside any aggregate are drawn where they are', () => {
    expect(processEdge(displays.representative!, displays.outside!)).toEqual([10, 20, 50, 60])
  })

  test('an anchor that is not drawn falls back to the node itself, never to the origin', () => {
    expect(anchoredDisplay(displays.orphan!, (nodeId) => displays[nodeId])).toBe(displays.orphan)
    expect(processEdge(displays.orphan!, displays.outside!)).toEqual([1, 2, 50, 60])
  })
})
