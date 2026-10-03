import { readFileSync } from 'node:fs'
import { resolveGraphSource } from '../scripts/graph-source.mjs'
import { beforeAll, describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import {
  buildGraph,
  computeVisibility,
  DEFAULT_FILTERS,
  NO_PROJECT,
  NO_SCOPE,
  getConnectedComponents,
  isNodeVisible,
  planLayout,
  runForceLayout,
} from '@/graph'
import { buildSearchIndex } from '@/search'
import type { GraphModel } from '@/types/graph'

/**
 * Contract test against the real Graphify output (read-only). Expectations are
 * computed from the raw file, so they keep holding after a regeneration.
 */
// Graphify's output where it exists, the versioned snapshot elsewhere (CI, other computers).
const GRAPH_PATH = resolveGraphSource().path

interface RawGraph {
  nodes: { id: string; community: number | null; source_file: string }[]
  links: { source: string; target: string; relation: string }[]
}

let raw: RawGraph
let model: GraphModel

beforeAll(() => {
  raw = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')) as RawGraph
  model = adaptGraphify(raw)
})

describe('real graph.json', () => {
  test('loads and passes schema validation', () => {
    expect(model.nodes.length).toBeGreaterThan(0)
    expect(model.edges.length).toBeGreaterThan(0)
  })

  test('has the same number of nodes and edges as the file', () => {
    expect(model.nodes).toHaveLength(raw.nodes.length)
    expect(model.edges).toHaveLength(raw.links.length)
  })

  test('preserves every node id in order', () => {
    expect(model.nodes.map((node) => node.id)).toEqual(raw.nodes.map((node) => node.id))
  })

  test('preserves source, target and relation of every edge', () => {
    const adapted = model.edges.map(({ source, target, relation }) => [source, target, relation])
    const original = raw.links.map(({ source, target, relation }) => [source, target, relation])

    expect(adapted).toEqual(original)
  })

  test('finds every community present in the file', () => {
    const rawCommunities = new Set(raw.nodes.map((node) => node.community))
    rawCommunities.delete(null)

    expect(model.communities).toHaveLength(rawCommunities.size)
    expect(model.communities.reduce((total, community) => total + community.size, 0)).toBe(
      raw.nodes.filter((node) => node.community !== null).length,
    )
    expect(model.communities.every((community) => community.name.length > 0)).toBe(true)
  })

  test('degrees add up to twice the number of edges', () => {
    const totalDegree = model.nodes.reduce((total, node) => total + node.degree, 0)

    expect(totalDegree).toBe(raw.links.length * 2)
  })

  test('flags exactly the nodes that live in minified files', () => {
    const minified = raw.nodes.filter((node) => /\.min\.js$/.test(node.source_file)).length

    expect(model.metadata.thirdPartyNodeCount).toBe(minified)
  })

  test('leaves no decomposed (NFD) path behind', () => {
    expect(model.nodes.every((node) => node.sourceFile === node.sourceFile.normalize('NFC'))).toBe(true)
  })

  test('feeds graphology without losing anything', () => {
    const graph = buildGraph(model)

    expect(graph.order).toBe(raw.nodes.length)
    expect(graph.size).toBe(raw.links.length)
    expect(getConnectedComponents(graph).flat()).toHaveLength(raw.nodes.length)
  })

  test('lays out the default view with finite, distinct positions', () => {
    const visible = model.nodes.filter((node) => isNodeVisible(node, DEFAULT_FILTERS))
    const ids = new Set(visible.map((node) => node.id))
    const edges = model.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    const plan = planLayout(visible, edges, new Map())

    const positions = runForceLayout(plan.request)

    expect(positions).toHaveLength(visible.length * 2)
    expect(positions.every((value) => Number.isFinite(value))).toBe(true)
    const points = new Set(visible.map((_node, i) => `${positions[i * 2]},${positions[i * 2 + 1]}`))
    expect(points.size).toBe(visible.length)
  })
})

describe('exploration over the real graph', () => {
  test('every node can be found by its own label', () => {
    const index = buildSearchIndex(model)
    // A spread of nodes across the file, not just the first ones.
    const sample = model.nodes.filter((_node, position) => position % 97 === 0)

    for (const node of sample) {
      const { hits } = index.search(node.label, model.nodes.length)
      expect(hits.some((hit) => hit.node.id === node.id)).toBe(true)
    }
  })

  test('every community draws exactly its members and can be cleared', () => {
    const everything = { ...DEFAULT_FILTERS, hideThirdParty: false }
    for (const community of model.communities) {
      const scoped = computeVisibility(model, everything, { ...NO_SCOPE, community: community.id })
      expect(scoped.nodeIds.size).toBe(community.size)
      expect(scoped.communityCount).toBe(1)
    }
    expect(computeVisibility(model, everything, NO_SCOPE).nodeIds.size).toBe(model.nodes.length)
  })

  test('projects partition the graph: their scoped counts add up to the total', () => {
    const everything = { ...DEFAULT_FILTERS, hideThirdParty: false }
    // projectCounts already carries the '' bucket of root-level and external nodes.
    const projects = Object.keys(model.metadata.projectCounts)
    expect(projects).toContain(NO_PROJECT)
    const drawn = projects.map(
      (project) => computeVisibility(model, everything, { ...NO_SCOPE, project }).nodeIds.size,
    )

    expect(drawn.reduce((sum, count) => sum + count, 0)).toBe(model.nodes.length)
  })
})
