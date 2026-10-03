import type { GraphIndex, KnowledgeGraph } from '@/graph'
import { useExpansion, usePathView } from '@/state/selectors'
import { useAppStore } from '@/state/store'
import type { GraphModel } from '@/types/graph'
import { formatCount } from '@/ui/primitives'

interface NavigationStatusProps {
  readonly model: GraphModel
  readonly index: GraphIndex
  readonly graph: KnowledgeGraph
}

function hops(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'hop' : 'hops'}`
}

/**
 * Says which mode the graph is in (picking a path, showing one, showing an
 * expansion, community view) and offers the way out. Visible with every panel
 * closed, so a dimmed graph is never left unexplained.
 */
export function NavigationStatus({ model, index, graph }: NavigationStatusProps) {
  const pathView = usePathView(model, graph, index)
  const expansion = useExpansion(model, graph)
  const clearPath = useAppStore((state) => state.clearPath)
  const setExpansion = useAppStore((state) => state.setExpansion)
  const isCommunityMode = useAppStore((state) => state.aggregation.mode === 'communities')
  const expandedCount = useAppStore((state) => state.aggregation.exceptions.length)
  const setCommunityMode = useAppStore((state) => state.setCommunityMode)
  const labelOf = (nodeId: string): string => index.nodeById.get(nodeId)?.label ?? nodeId

  if (pathView.status === 'picking') {
    return (
      <div className="eog-mode" role="status" data-tone="active">
        <span className="eog-label">Path from</span>
        <span className="eog-mode__text">{labelOf(pathView.fromId)}</span>
        <span className="eog-mode__hint">Select the destination node</span>
        <button type="button" className="eog-link" onClick={clearPath}>
          Cancel
        </button>
      </div>
    )
  }
  if (pathView.status === 'found' || pathView.status === 'none') {
    return (
      <div className="eog-mode" role="status" data-tone={pathView.status === 'found' ? 'active' : 'warn'}>
        <span className="eog-label">Path</span>
        <span className="eog-mode__text">
          {pathView.status === 'found' ? hops(pathView.path.steps.length) : 'No path found'}
        </span>
        <button type="button" className="eog-link" onClick={clearPath}>
          Clear path
        </button>
      </div>
    )
  }
  if (expansion) {
    return (
      <div className="eog-mode" role="status" data-tone="active">
        <span className="eog-label">Expansion</span>
        <span className="eog-mode__text">
          Depth {expansion.depth} · {formatCount(expansion.nodeIds.size)} nodes
          {expansion.isTruncated && ' (limit reached)'}
        </span>
        <button type="button" className="eog-link" onClick={() => setExpansion(expansion.rootId, null)}>
          Clear
        </button>
      </div>
    )
  }
  if (isCommunityMode) {
    return (
      <div className="eog-mode" role="status" data-tone="active">
        <span className="eog-label">Community view</span>
        <span className="eog-mode__text">
          {expandedCount === 0 ? 'Every community collapsed' : `${formatCount(expandedCount)} expanded`}
        </span>
        <button type="button" className="eog-link" onClick={() => setCommunityMode(false)}>
          Back to nodes
        </button>
      </div>
    )
  }
  return null
}
