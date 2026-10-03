import { adaptGraphify, fetchGraphJson, GraphifySchemaError } from '@/data'
import {
  applyPositions,
  buildGraph,
  buildGraphIndex,
  computeLayout,
  computeVisibleNodeIds,
  readPositionCache,
  writePositionCache,
  type PositionStorage,
} from '@/graph'
import { buildSearchIndex } from '@/search'
import type { GraphModel, PositionMap } from '@/types/graph'
import { useAppStore, type GraphData } from './store'
import { restoreViewFromUrl } from './url-sync'

/** localStorage can be missing or throw (privacy modes): then there is simply no cache. */
function getPositionStorage(): PositionStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Lays out the nodes in `nodeIds` that have no position yet. Nodes already in
 * `positions` are sent along pinned, so the existing picture never moves.
 */
async function layoutMissing(
  model: GraphModel,
  positions: PositionMap,
  nodeIds: ReadonlySet<string>,
): Promise<PositionMap> {
  const scope = model.nodes.filter((node) => positions.has(node.id) || nodeIds.has(node.id))
  const scopeIds = new Set(scope.map((node) => node.id))
  const edges = model.edges.filter(
    (edge) => scopeIds.has(edge.source) && scopeIds.has(edge.target),
  )
  return computeLayout(scope, edges, positions)
}

function toErrorState(error: unknown): GraphData {
  return {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
    issues: error instanceof GraphifySchemaError ? error.issues : [],
  }
}

/**
 * Runs the whole pipeline once: JSON → adapter → model → graphology →
 * layout worker → positions. Results and timings land in the store.
 */
export async function loadGraphSession(signal: AbortSignal): Promise<void> {
  const { setData, recordMetrics } = useAppStore.getState()
  setData({ status: 'loading', stage: 'fetching' })
  try {
    const startedAt = performance.now()
    const raw = await fetchGraphJson(undefined, signal)
    const fetchedAt = performance.now()
    if (signal.aborted) return
    setData({ status: 'loading', stage: 'adapting' })
    const model = adaptGraphify(raw)
    const adaptedAt = performance.now()
    const index = buildGraphIndex(model)
    const graph = buildGraph(model)
    const builtAt = performance.now()
    const search = buildSearchIndex(model)
    const indexedAt = performance.now()
    setData({ status: 'loading', stage: 'layout' })

    const storage = getPositionStorage()
    const cached = storage
      ? readPositionCache(storage, new Set(index.nodeById.keys()))
      : new Map()
    const visible = computeVisibleNodeIds(model, useAppStore.getState().filters)
    const positions = await layoutMissing(model, cached, visible)
    const laidOutAt = performance.now()
    if (signal.aborted) return

    applyPositions(graph, positions)
    if (storage) writePositionCache(storage, positions)
    recordMetrics({
      loadMs: fetchedAt - startedAt,
      adaptMs: adaptedAt - fetchedAt,
      graphBuildMs: builtAt - adaptedAt,
      searchIndexMs: indexedAt - builtAt,
      layoutMs: laidOutAt - indexedAt,
      cachedPositions: cached.size,
    })
    setData({ status: 'ready', model, index, search, graph, positions })
    // Same tick as "ready": the world mounts already showing the linked view.
    if (typeof window !== 'undefined') restoreViewFromUrl(window.location.search)
  } catch (error) {
    if (!signal.aborted) setData(toErrorState(error))
  }
}

/**
 * Makes sure every node in `nodeIds` has a position, e.g. after a filter
 * reveals third-party code. A no-op when nothing is missing.
 */
export async function ensurePositions(nodeIds: ReadonlySet<string>): Promise<void> {
  const state = useAppStore.getState()
  const { data } = state
  if (data.status !== 'ready' || state.isLayoutRunning) return
  const hasMissing = [...nodeIds].some((id) => !data.positions.has(id))
  if (!hasMissing) return

  state.setLayoutRunning(true)
  try {
    const startedAt = performance.now()
    const positions = await layoutMissing(data.model, data.positions, nodeIds)
    // The graph may have been reloaded while the worker was busy.
    if (useAppStore.getState().data !== data) return
    applyPositions(data.graph, positions)
    const storage = getPositionStorage()
    if (storage) writePositionCache(storage, positions)
    state.recordMetrics({ incrementalLayoutMs: performance.now() - startedAt })
    state.setData({ ...data, positions })
  } catch (error) {
    state.setData(toErrorState(error))
  } finally {
    state.setLayoutRunning(false)
  }
}
