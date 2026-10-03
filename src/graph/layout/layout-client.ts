import type { PositionMap } from '@/types/graph'
import type { LayoutRequest, LayoutResponse } from './force-layout'
import { planLayout, toPositionMap, type LayoutEdge } from './plan'
import type { LayoutNode } from './seed'

function runInWorker(request: LayoutRequest): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<LayoutResponse>) => {
      worker.terminate()
      resolve(event.data.positions)
    })
    worker.addEventListener('error', (event) => {
      worker.terminate()
      reject(new Error(`Layout worker failed: ${event.message}`))
    })
    worker.postMessage(request, [
      request.positions.buffer,
      request.fixed.buffer,
      request.edges.buffer,
    ])
  })
}

/**
 * Positions for `nodes`. Cached positions win and are never recomputed; the
 * worker only runs when at least one node has none.
 */
export async function computeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  cached: PositionMap,
): Promise<PositionMap> {
  const plan = planLayout(nodes, edges, cached)
  if (plan.freeCount === 0) return toPositionMap(nodes, plan.request.positions, cached)
  const positions = await runInWorker(plan.request)
  return toPositionMap(nodes, positions, cached)
}
