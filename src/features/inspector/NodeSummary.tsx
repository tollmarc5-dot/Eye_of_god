import type { ReactNode } from 'react'
import { folderLabel, projectLabel } from '@/features/explorer/explorer-data'
import { projectKeyOf, type NodeAnalysis } from '@/graph'
import type { Community, InternalNode } from '@/types/graph'
import { formatCount } from '@/ui/primitives'
import { communityColor } from '@/utils/color'

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="eog-field">
      <dt className="eog-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="eog-metric">
      <dt className="eog-label">{label}</dt>
      <dd className="eog-metric__value">{formatCount(value)}</dd>
    </div>
  )
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

interface NodeSummaryProps {
  readonly node: InternalNode
  readonly community: Community | undefined
  readonly analysis: NodeAnalysis
  /** Neighbours the current filters and scope do not draw. */
  readonly hiddenNeighborCount: number
  /** Nodes → community: opens the community the node belongs to. */
  readonly onOpenCommunity: (communityId: number) => void
}

/**
 * What the inspected node is: kind and name. It stays pinned to the top of the
 * inspector while the rest scrolls, so the selection is never anonymous.
 */
export function NodeIdentity({ node }: { readonly node: InternalNode }) {
  return (
    <div className="eog-node-identity">
      <div className="eog-node__tags">
        <span className="eog-tag eog-tag--accent">{node.kind}</span>
        {node.isCallable && <span className="eog-tag">Callable</span>}
        {node.isExternal && <span className="eog-tag">External</span>}
      </div>
      <p className="eog-node__name">{node.label}</p>
    </div>
  )
}

/** Location and graph metrics. Every value comes from the internal model. */
export function NodeSummary({ node, community, analysis, hiddenNeighborCount, onOpenCommunity }: NodeSummaryProps) {
  // The folder inside the project: the project name itself is shown on its own line.
  const folderInProject = node.project === null ? node.folder : node.folder.split('/').slice(1).join('/')
  return (
    <div className="eog-node">
      {/* Graph text is untrusted: rendered as text only. */}
      {node.rationale && <p className="eog-node__note">{node.rationale}</p>}

      <h3 className="eog-label eog-node__heading">Location</h3>
      <dl className="eog-fields">
        <Field label="Type">{node.kind}</Field>
        <Field label="File">
          <span className="eog-mono">{node.sourceFile || 'No source file'}</span>
          {node.sourceLocation && (
            <span className="eog-mono eog-field__aside"> · {node.sourceLocation}</span>
          )}
        </Field>
        <Field label="Project">{projectLabel(projectKeyOf(node))}</Field>
        {node.sourceFile && (
          <Field label="Folder">
            <span className="eog-mono">{folderLabel(folderInProject)}</span>
          </Field>
        )}
        <Field label="Community">
          <span className="eog-field__inline">
            <span
              className="eog-swatch"
              style={{ background: communityColor(node.community) }}
              aria-hidden="true"
            />
            {community?.name ?? 'No community'}
          </span>
          {community && (
            <button
              type="button"
              className="eog-link"
              aria-label={`Open community ${community.name}`}
              onClick={() => onOpenCommunity(community.id)}
            >
              Open community
            </button>
          )}
        </Field>
        <Field label="Origin">
          {node.isThirdParty ? 'Third-party code' : 'Project code'}
          {node.origin && <span className="eog-mono eog-field__aside"> · extracted by {node.origin}</span>}
        </Field>
      </dl>

      <h3 className="eog-label eog-node__heading">Graph</h3>
      <dl className="eog-metrics">
        <Metric label="Degree" value={node.degree} />
        <Metric label="Incoming" value={node.inDegree} />
        <Metric label="Outgoing" value={node.outDegree} />
        <Metric label="Neighbours" value={analysis.neighborCount} />
      </dl>
      <p className="eog-node__footnote">
        {plural(analysis.relationCount, 'relation', 'relations')}
        {analysis.selfCount > 0 &&
          ` · ${plural(analysis.selfCount, 'self-reference', 'self-references')} (counted in and out)`}
        {hiddenNeighborCount > 0 &&
          ` · ${plural(hiddenNeighborCount, 'neighbour', 'neighbours')} outside the current view`}
      </p>
    </div>
  )
}
