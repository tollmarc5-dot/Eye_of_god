import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'

/**
 * Worker protocol. Everything is index-based typed arrays: the worker never
 * sees node ids, labels or any other part of the model.
 */
export interface LayoutRequest {
  /** Starting [x0, y0, x1, y1, …], one pair per node. */
  readonly positions: Float32Array
  /** 1 = the node already has a final position and must not move. */
  readonly fixed: Uint8Array
  /** [source0, target0, source1, target1, …] as node indices. */
  readonly edges: Uint32Array
  readonly iterations: number
}

export interface LayoutResponse {
  /** Final [x0, y0, x1, y1, …] in the same node order as the request. */
  readonly positions: Float32Array
}

const BARNES_HUT_MIN_NODES = 1000

/**
 * Runs ForceAtlas2 for a fixed number of iterations and stops. It has no
 * randomness, so the same request always yields the same positions.
 */
export function runForceLayout(request: LayoutRequest): Float32Array {
  const nodeCount = request.fixed.length
  if (request.positions.length !== nodeCount * 2) {
    throw new Error(
      `Layout request mismatch: ${nodeCount} nodes but ${request.positions.length} coordinates`,
    )
  }
  if (request.edges.length % 2 !== 0) {
    throw new Error('Layout request mismatch: edges must be index pairs')
  }

  const graph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false })
  for (let index = 0; index < nodeCount; index += 1) {
    graph.addNode(index, {
      x: request.positions[index * 2],
      y: request.positions[index * 2 + 1],
      fixed: request.fixed[index] === 1,
    })
  }
  for (let offset = 0; offset < request.edges.length; offset += 2) {
    const source = request.edges[offset]
    const target = request.edges[offset + 1]
    if (source === undefined || target === undefined || source >= nodeCount || target >= nodeCount) {
      throw new Error(`Layout request mismatch: edge ${offset / 2} points outside the node list`)
    }
    if (source !== target) graph.mergeEdge(source, target)
  }

  if (request.iterations > 0 && nodeCount > 0) {
    forceAtlas2.assign(graph, {
      iterations: request.iterations,
      settings: {
        ...forceAtlas2.inferSettings(nodeCount),
        barnesHutOptimize: nodeCount > BARNES_HUT_MIN_NODES,
      },
    })
  }

  const result = new Float32Array(nodeCount * 2)
  graph.forEachNode((key, attributes) => {
    const index = Number(key)
    result[index * 2] = attributes.x as number
    result[index * 2 + 1] = attributes.y as number
  })
  return result
}
