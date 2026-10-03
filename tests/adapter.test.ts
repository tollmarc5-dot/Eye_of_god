import { describe, expect, test } from 'vitest'
import { adaptGraphify, GraphifySchemaError } from '@/data'
import { makeRawGraph } from './fixtures'

function nodeOf(id: string) {
  const node = adaptGraphify(makeRawGraph()).nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`fixture has no node ${id}`)
  return node
}

function schemaErrorOf(raw: unknown): GraphifySchemaError {
  try {
    adaptGraphify(raw)
  } catch (error) {
    if (error instanceof GraphifySchemaError) return error
    throw error
  }
  throw new Error('expected adaptGraphify to throw')
}

describe('adaptGraphify', () => {
  test('keeps every node and edge', () => {
    const model = adaptGraphify(makeRawGraph())

    expect(model.nodes).toHaveLength(6)
    expect(model.edges).toHaveLength(4)
    expect(model.metadata.nodeCount).toBe(6)
    expect(model.metadata.edgeCount).toBe(4)
  })

  test('preserves ids, direction and relation of edges', () => {
    const model = adaptGraphify(makeRawGraph())

    expect(model.nodes.map((node) => node.id)).toEqual(makeRawGraph().nodes.map((node) => node.id))
    expect(model.edges[1]).toMatchObject({
      source: 'app_index_main',
      target: 'app_lib_xlsx_min_s',
      relation: 'calls',
    })
  })

  test('gives every edge a unique, deterministic id', () => {
    const raw = makeRawGraph()
    const duplicated = { ...raw, links: [...raw.links, raw.links[0]] }

    const ids = adaptGraphify(duplicated).edges.map((edge) => edge.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('app_index|contains|app_index_main')
    expect(ids.at(-1)).toBe('app_index|contains|app_index_main#1')
  })

  test('derives project, folder, file name and extension from source_file', () => {
    expect(nodeOf('app_lib_xlsx_min_s')).toMatchObject({
      project: 'app',
      folder: 'app/public/lib',
      fileName: 'xlsx.full.min.js',
      extension: 'js',
    })
  })

  test('root-level and external nodes have no project', () => {
    expect(nodeOf('lonely')).toMatchObject({ project: null, folder: '', extension: '' })
    expect(nodeOf('os')).toMatchObject({ project: null, fileName: '', isExternal: true })
  })

  test('normalises paths to NFC so typed text matches', () => {
    const node = nodeOf('docs_readme')

    expect(node.sourceFile).toBe('mhd-aplicación/README.md')
    expect(node.project).toBe('mhd-aplicación')
  })

  test('computes degree from edges, counting a self-loop on both ends', () => {
    expect(nodeOf('app_index_main')).toMatchObject({ inDegree: 2, outDegree: 3, degree: 5 })
    expect(nodeOf('lonely').degree).toBe(0)
  })

  test('flags minified code as third party without dropping it', () => {
    const model = adaptGraphify(makeRawGraph())

    expect(nodeOf('app_lib_xlsx_min_s').isThirdParty).toBe(true)
    expect(nodeOf('app_index_main').isThirdParty).toBe(false)
    expect(model.metadata.thirdPartyNodeCount).toBe(1)
    expect(model.metadata.thirdPartyEdgeCount).toBe(1)
  })

  test('accepts custom third-party patterns', () => {
    const model = adaptGraphify(makeRawGraph(), { thirdPartyPatterns: [/^app\/src\//] })

    expect(model.metadata.thirdPartyNodeCount).toBe(2)
  })

  test('groups nodes into communities with a placeholder name', () => {
    const model = adaptGraphify(makeRawGraph())

    expect(model.communities.map((community) => community.id)).toEqual([0, 1, 2, 3])
    expect(model.communities[0]).toMatchObject({
      size: 3,
      hubNodeId: 'app_index_main',
      name: 'Community 0',
      nameSource: 'placeholder',
    })
  })

  test('prefers a real Graphify community label over the placeholder', () => {
    const raw = makeRawGraph()
    const labelled = {
      ...raw,
      nodes: raw.nodes.map((node) =>
        node.community === 0 ? { ...node, community_name: 'App Core' } : { ...node, community_name: `Community ${node.community}` },
      ),
    }

    const [first, second] = adaptGraphify(labelled).communities

    expect(first).toMatchObject({ name: 'App Core', nameSource: 'graphify' })
    expect(second).toMatchObject({ name: 'Community 1', nameSource: 'placeholder' })
  })

  test('reports isolated nodes, self-loops and per-category counts', () => {
    const { metadata } = adaptGraphify(makeRawGraph())

    expect(metadata.isolatedNodeCount).toBe(2)
    expect(metadata.selfLoopCount).toBe(1)
    expect(metadata.relationCounts).toEqual({ contains: 1, calls: 2, imports: 1 })
    expect(metadata.extensionCounts).toMatchObject({ js: 3, md: 1 })
  })

  test('does not mutate its input', () => {
    const raw = makeRawGraph()
    const snapshot = JSON.stringify(raw)

    adaptGraphify(raw)

    expect(JSON.stringify(raw)).toBe(snapshot)
  })

  test('ignores fields Graphify adds later', () => {
    const raw = makeRawGraph()
    const extended = { ...raw, built_at_commit: 'abc', nodes: raw.nodes.map((node) => ({ ...node, new_field: 1 })) }

    expect(adaptGraphify(extended).nodes).toHaveLength(6)
  })
})

describe('adaptGraphify with an invalid schema', () => {
  test('names the missing top-level key', () => {
    const { links, ...rest } = makeRawGraph()
    const renamed = { ...rest, edges: links }

    const error = schemaErrorOf(renamed)

    expect(error.issues.map((issue) => issue.path)).toContain('links')
    expect(error.message).toContain('links')
  })

  test('groups a field that changed on every node into one issue', () => {
    const raw = makeRawGraph()
    const drifted = {
      ...raw,
      nodes: raw.nodes.map(({ source_file, ...node }) => ({ ...node, path: source_file })),
    }

    const error = schemaErrorOf(drifted)

    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]).toMatchObject({
      path: 'nodes[].source_file',
      count: 6,
      example: 'nodes[0].source_file',
    })
  })

  test('rejects a field whose type changed', () => {
    const raw = makeRawGraph()
    const drifted = { ...raw, nodes: raw.nodes.map((node) => ({ ...node, community: String(node.community) })) }

    expect(schemaErrorOf(drifted).issues[0]?.path).toBe('nodes[].community')
  })

  test('rejects edges that point at unknown nodes', () => {
    const raw = makeRawGraph()
    const dangling = { ...raw, links: [...raw.links, { ...raw.links[0], target: 'ghost' }] }

    expect(schemaErrorOf(dangling).issues[0]).toMatchObject({
      path: 'links[].target',
      example: 'links[4].target',
    })
  })

  test('rejects duplicate node ids', () => {
    const raw = makeRawGraph()
    const duplicated = { ...raw, nodes: [...raw.nodes, raw.nodes[0]] }

    expect(schemaErrorOf(duplicated).issues[0]?.message).toContain('duplicate')
  })

  test.each([null, 42, 'graph', []])('rejects non-graph input %j', (input) => {
    expect(() => adaptGraphify(input)).toThrow(GraphifySchemaError)
  })
})
