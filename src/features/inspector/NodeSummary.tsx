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

/** One figure of the identity strip: the number reads first, its name under it. */
function Figure({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="eog-figure">
      <dt className="eog-figure__label">{label}</dt>
      <dd className="eog-figure__value">{formatCount(value)}</dd>
    </div>
  )
}

/** "a/b/c/d/file.ts" → "…/d/file.ts": enough to place it; the full path is in Location. */
function shortPath(path: string): string {
  const segments = path.split('/')
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join('/')}`
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

interface NodeSummaryProps {
  readonly node: InternalNode
  readonly analysis: NodeAnalysis
  /** Neighbours the current filters and scope do not draw. */
  readonly hiddenNeighborCount: number
}

/**
 * What the inspected node is: kind, name and where it lives. It stays pinned
 * to the top of the inspector while the rest scrolls, so the selection is
 * never anonymous. Kept short: on a phone the sheet is only half the screen.
 */
export function NodeIdentity({ node, community }: { readonly node: InternalNode; readonly community?: Community }) {
  return (
    <div className="eog-node-identity">
      <div className="eog-node__tags">
        <span className="eog-tag eog-tag--accent">{node.kind}</span>
        {node.isCallable && <span className="eog-tag">Callable</span>}
        {node.isExternal && <span className="eog-tag">External</span>}
        {node.isThirdParty && <span className="eog-tag">Third-party</span>}
      </div>
      {/* Graph text is untrusted: rendered as text only. */}
      <p className="eog-node__name">{node.label}</p>
      {community && (
        <p className="eog-node__community">
          <span className="eog-swatch" style={{ background: communityColor(node.community) }} aria-hidden="true" />
          {community.name}
        </p>
      )}
      {node.sourceFile && <p className="eog-node__path eog-mono">{shortPath(node.sourceFile)}</p>}
    </div>
  )
}

/** How connected the node is: its four figures, its note and its relation count. */
export function NodeSummary({ node, analysis, hiddenNeighborCount }: NodeSummaryProps) {
  return (
    <div className="eog-node">
      <dl className="eog-figures">
        <Figure label="Degree" value={node.degree} />
        <Figure label="Incoming" value={node.inDegree} />
        <Figure label="Outgoing" value={node.outDegree} />
        <Figure label="Neighbours" value={analysis.neighborCount} />
      </dl>
      <p className="eog-node__footnote">
        {plural(analysis.relationCount, 'relation', 'relations')}
        {analysis.selfCount > 0 &&
          ` · ${plural(analysis.selfCount, 'self-reference', 'self-references')} (counted in and out)`}
        {hiddenNeighborCount > 0 &&
          ` · ${plural(hiddenNeighborCount, 'neighbour', 'neighbours')} outside the current view`}
      </p>
      {/* Graph text is untrusted: rendered as text only. */}
      {node.rationale && <p className="eog-node__note">{node.rationale}</p>}
    </div>
  )
}

interface NodeMetadataProps {
  readonly node: InternalNode
  readonly community: Community | undefined
  /** Nodes → community: opens the community the node belongs to. */
  readonly onOpenCommunity: (communityId: number) => void
}

/** Where the node lives: file, project, folder, community, origin. After the relationships. */
export function NodeMetadata({ node, community, onOpenCommunity }: NodeMetadataProps) {
  // The folder inside the project: the project name itself is shown on its own line.
  const folderInProject = node.project === null ? node.folder : node.folder.split('/').slice(1).join('/')
  return (
    <div className="eog-node eog-node--metadata">
      <h3 className="eog-heading eog-node__heading">Location</h3>
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
    </div>
  )
}
