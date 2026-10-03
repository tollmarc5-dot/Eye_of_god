import type { GraphIndex, PathStep } from '@/graph'
import type { PathView } from '@/state/selectors'
import { ArrowInIcon, ArrowOutIcon } from '@/ui/icons'
import { formatCount, moveBetweenRows } from '@/ui/primitives'

/** Longer routes are listed in full but scroll inside the panel. */
const MAX_RELATIONS_PER_STEP = 3

function StepRelations({ step }: { readonly step: PathStep }) {
  const relations = [...new Set(step.edges.map((edge) => edge.relation))]
  const shown = relations.slice(0, MAX_RELATIONS_PER_STEP)
  return (
    <li className="eog-path__hop" aria-label={`${step.isForward ? 'then' : 'reached against the relation'} ${shown.join(', ')}`}>
      {step.isForward ? <ArrowOutIcon size={12} /> : <ArrowInIcon size={12} />}
      <span className="eog-mono">
        {shown.join(' · ')}
        {relations.length > shown.length && ` +${relations.length - shown.length}`}
      </span>
    </li>
  )
}

interface PathPanelProps {
  readonly pathView: PathView
  readonly index: GraphIndex
  readonly selectedNodeId: string | null
  readonly onOpen: (nodeId: string) => void
  readonly onClear: () => void
}

/**
 * The "path to" mode inside the inspector: what is being asked, the route
 * found (every node navigable, every hop with its real relations) or why
 * there is none.
 */
export function PathPanel({ pathView, index, selectedNodeId, onOpen, onClear }: PathPanelProps) {
  if (pathView.status === 'idle') return null
  const labelOf = (nodeId: string): string => index.nodeById.get(nodeId)?.label ?? nodeId

  return (
    <section className="eog-path" aria-label="Path">
      <header className="eog-path__head">
        <h3 className="eog-label">Path</h3>
        <button type="button" className="eog-link" onClick={onClear}>
          {pathView.status === 'picking' ? 'Cancel' : 'Clear path'}
        </button>
      </header>

      {pathView.status === 'picking' && (
        <p className="eog-path__text">
          From <strong>{labelOf(pathView.fromId)}</strong>. Select the destination: click a node, search it or
          pick it from a list. Esc cancels.
        </p>
      )}

      {pathView.status === 'none' && (
        <>
          <p className="eog-path__title">No path found</p>
          <p className="eog-path__text">
            {pathView.existsOutsideView
              ? `${labelOf(pathView.fromId)} and ${labelOf(pathView.toId)} are only connected through nodes that the current filters or scope hide.`
              : `${labelOf(pathView.fromId)} and ${labelOf(pathView.toId)} are not connected in the graph.`}
          </p>
        </>
      )}

      {pathView.status === 'found' && pathView.path.steps.length === 0 && (
        <p className="eog-path__text">Origin and destination are the same node: there is nothing to walk.</p>
      )}

      {pathView.status === 'found' && pathView.path.steps.length > 0 && (
        <>
          <p className="eog-path__title">
            {formatCount(pathView.path.steps.length)} {pathView.path.steps.length === 1 ? 'hop' : 'hops'} ·{' '}
            {formatCount(pathView.path.nodeIds.length)} nodes
          </p>
          <ol className="eog-path__route" onKeyDown={moveBetweenRows}>
            {pathView.path.nodeIds.map((nodeId, position) => {
              const step = pathView.path.steps[position - 1]
              return [
                step && <StepRelations key={`hop-${nodeId}`} step={step} />,
                <li key={nodeId}>
                  <button
                    type="button"
                    className="eog-row"
                    aria-current={nodeId === selectedNodeId ? 'true' : undefined}
                    aria-label={`Step ${position + 1}: ${labelOf(nodeId)}. Inspect`}
                    onClick={() => onOpen(nodeId)}
                  >
                    <span className="eog-row__value">{position + 1}</span>
                    <span className="eog-row__name">{labelOf(nodeId)}</span>
                  </button>
                </li>,
              ]
            })}
          </ol>
          <p className="eog-path__text">Shortest connection by number of hops; relation direction is ignored.</p>
        </>
      )}
    </section>
  )
}
