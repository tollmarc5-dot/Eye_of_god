import { describe, expect, test } from 'vitest'
import { adaptGraphify } from '@/data'
import { buildExplorerFacets } from '@/features/explorer/explorer-data'
import {
  buildGraphIndex,
  computeVisibility,
  computeVisibleNodeIds,
  DEFAULT_FILTERS,
  NO_SCOPE,
  revealNode,
} from '@/graph'
import type { GraphFilters, GraphScope } from '@/types/graph'
import { makeRawGraph } from './fixtures'

const model = adaptGraphify(makeRawGraph())
const index = buildGraphIndex(model)
const ALL: GraphFilters = { ...DEFAULT_FILTERS, hideThirdParty: false }
const scopeWith = (patch: Partial<GraphScope>): GraphScope => ({ ...NO_SCOPE, ...patch })
const visible = (filters: GraphFilters, scope: GraphScope) =>
  [...computeVisibleNodeIds(model, filters, scope)].sort()

describe('scope as a visibility mask', () => {
  test('third-party filter alone keeps its Phase 2 behaviour', () => {
    expect(visible(DEFAULT_FILTERS, NO_SCOPE)).not.toContain('app_lib_xlsx_min_s')
    expect(visible(ALL, NO_SCOPE)).toHaveLength(model.nodes.length)
  })

  test('a project shows only its nodes', () => {
    expect(visible(ALL, scopeWith({ project: 'app' }))).toEqual([
      'app_index',
      'app_index_main',
      'app_lib_xlsx_min_s',
    ])
    expect(visible(ALL, scopeWith({ project: '' }))).toEqual(['lonely', 'os'])
  })

  test('a folder narrows its project', () => {
    expect(visible(ALL, scopeWith({ project: 'app', folder: 'public' }))).toEqual(['app_lib_xlsx_min_s'])
    expect(visible(ALL, scopeWith({ project: 'app', folder: 'src' }))).toEqual(['app_index', 'app_index_main'])
  })

  test('a community shows only its members', () => {
    expect(visible(ALL, scopeWith({ community: 0 }))).toEqual(['app_index', 'app_index_main', 'os'])
  })

  test('filters and scope combine: all of them have to hold', () => {
    expect(visible(DEFAULT_FILTERS, scopeWith({ project: 'app' }))).toEqual(['app_index', 'app_index_main'])
    expect(visible(ALL, scopeWith({ project: 'app', community: 0 }))).toEqual(['app_index', 'app_index_main'])
    expect(visible(DEFAULT_FILTERS, scopeWith({ project: 'app', community: 1 }))).toEqual([])
    expect(visible({ ...ALL, hideIsolated: true }, scopeWith({ project: '' }))).toEqual(['os'])
  })

  test('clearing the scope restores exactly the previous set', () => {
    const before = visible(DEFAULT_FILTERS, NO_SCOPE)

    computeVisibleNodeIds(model, DEFAULT_FILTERS, scopeWith({ community: 2 }))

    expect(visible(DEFAULT_FILTERS, NO_SCOPE)).toEqual(before)
    expect(model.nodes).toHaveLength(6)
  })

  test('counts nodes, relations and communities of what is drawn', () => {
    expect(computeVisibility(model, ALL, NO_SCOPE)).toMatchObject({ edgeCount: 4, communityCount: 4 })
    // Hiding third-party code drops the call into xlsx.
    expect(computeVisibility(model, DEFAULT_FILTERS, NO_SCOPE)).toMatchObject({ edgeCount: 3, communityCount: 3 })
    const community = computeVisibility(model, ALL, scopeWith({ community: 0 }))
    expect(community.nodeIds.size).toBe(3)
    expect(community).toMatchObject({ edgeCount: 3, communityCount: 1 })
  })
})

describe('revealNode', () => {
  const node = (id: string) => {
    const found = index.nodeById.get(id)
    if (!found) throw new Error(`fixture node ${id} is missing`)
    return found
  }

  test('changes nothing for a node that is already drawn', () => {
    const scope = scopeWith({ community: 0 })
    const view = revealNode(node('os'), DEFAULT_FILTERS, scope)

    expect(view.filters).toBe(DEFAULT_FILTERS)
    expect(view.scope).toBe(scope)
  })

  test('switches third-party code on for a third-party node', () => {
    expect(revealNode(node('app_lib_xlsx_min_s'), DEFAULT_FILTERS, NO_SCOPE).filters.hideThirdParty).toBe(false)
  })

  test('drops only the parts of the scope that exclude the node', () => {
    const scope = scopeWith({ project: 'app', folder: 'src', community: 0 })

    expect(revealNode(node('os'), ALL, scope).scope).toEqual(scopeWith({ community: 0 }))
    expect(revealNode(node('app_lib_xlsx_min_s'), ALL, scope).scope).toEqual(scopeWith({ project: 'app' }))
  })
})

describe('explorer facets', () => {
  test('without a scope, counts are what the filters let through', () => {
    const facets = buildExplorerFacets(model, DEFAULT_FILTERS, NO_SCOPE, 10)

    // Ties are broken by name, so the order never depends on the input order.
    expect(facets.projects).toEqual([
      { name: '', count: 2 },
      { name: 'app', count: 2 },
      { name: 'mhd-aplicación', count: 1 },
    ])
    expect(facets.folders).toEqual([])
    expect(facets.communities.map((row) => [row.community.id, row.visibleSize])).toEqual([[0, 3], [2, 1], [3, 1]])
    expect(facets.visibleCount).toBe(5)
  })

  test('each list counts what picking that row would draw', () => {
    const facets = buildExplorerFacets(model, ALL, scopeWith({ project: 'app' }), 10)

    expect(facets.folders).toEqual([
      { name: 'src', count: 2 },
      { name: 'public', count: 1 },
    ])
    expect(facets.communities.map((row) => [row.community.id, row.visibleSize])).toEqual([[0, 2], [1, 1]])
    // Projects ignore the active project, so the others stay reachable.
    expect(facets.projects).toHaveLength(3)
  })

  test('key nodes are the best connected drawn nodes, in a stable order', () => {
    const facets = buildExplorerFacets(model, DEFAULT_FILTERS, scopeWith({ community: 0 }), 2)

    expect(facets.keyNodes.map((node) => node.id)).toEqual(['app_index_main', 'app_index'])
  })

  test('an active item with no nodes left is still listed so it can be cleared', () => {
    const facets = buildExplorerFacets(model, DEFAULT_FILTERS, scopeWith({ community: 1 }), 10)

    expect(facets.communities.find((row) => row.community.id === 1)?.visibleSize).toBe(0)
    expect(facets.visibleCount).toBe(0)
  })
})
