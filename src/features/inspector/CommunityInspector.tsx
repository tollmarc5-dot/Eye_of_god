import { folderLabel, projectLabel } from '@/features/explorer/explorer-data'
import { useGraphCommands } from '@/features/world/graph-commands'
import { isCommunityCollapsed, type CommunityDetails, type CountedName } from '@/graph'
import { useAppStore } from '@/state/store'
import { TargetIcon } from '@/ui/icons'
import { formatCount, HudButton, moveBetweenRows, Section } from '@/ui/primitives'
import { communityColor } from '@/utils/color'

const LISTED_FOLDERS = 6
const LISTED_COMMUNITIES = 8

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="eog-metric">
      <dt className="eog-label">{label}</dt>
      <dd className="eog-metric__value">{formatCount(value)}</dd>
    </div>
  )
}

/** "project/folder" as tallied by the graph layer → readable label. */
function folderPathLabel(name: string): string {
  const separator = name.indexOf('/')
  return `${projectLabel(name.slice(0, separator))} / ${folderLabel(name.slice(separator + 1))}`
}

function CountedRows({ items, labelOf }: { readonly items: readonly CountedName[]; readonly labelOf: (name: string) => string }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.name} className="eog-row">
          <span className="eog-row__name">{labelOf(item.name)}</span>
          <span className="eog-row__value">{formatCount(item.count)}</span>
        </li>
      ))}
    </ul>
  )
}

interface CommunityInspectorProps {
  readonly details: CommunityDetails
}

/**
 * Inspector view of a community: what it holds under the current filters,
 * where its nodes live, how to enter it (key nodes) and where to go next
 * (connected communities). Every figure is derived from the loaded graph.
 */
export function CommunityInspector({ details }: CommunityInspectorProps) {
  const { community, summary } = details
  const isCollapsed = useAppStore((state) => isCommunityCollapsed(state.aggregation, community.id))
  const isIsolated = useAppStore((state) => state.activeCommunity === community.id)
  const setCommunityCollapsed = useAppStore((state) => state.setCommunityCollapsed)
  const selectCommunity = useAppStore((state) => state.selectCommunity)
  const setActiveCommunity = useAppStore((state) => state.setActiveCommunity)
  const revealNode = useAppStore((state) => state.revealNode)
  const commands = useGraphCommands()
  const hiddenCount = community.size - summary.visibleCount

  const open = (communityId: number): void => {
    selectCommunity(communityId)
    commands.focusCommunity(communityId)
  }

  return (
    <>
      <div className="eog-node">
        <div className="eog-node__tags">
          <span className="eog-tag eog-tag--accent">Community</span>
          <span className="eog-tag">#{community.id}</span>
          <span className="eog-tag">{isCollapsed ? 'Collapsed' : 'Expanded'}</span>
          {isIsolated && <span className="eog-tag">Only this shown</span>}
        </div>
        <p className="eog-node__name">
          <span
            className="eog-swatch eog-swatch--large"
            style={{ background: communityColor(community.id) }}
            aria-hidden="true"
          />
          {community.name}
        </p>

        <h3 className="eog-label eog-node__heading">Graph</h3>
        <dl className="eog-metrics">
          <Metric label="Nodes" value={community.size} />
          <Metric label="Visible" value={summary.visibleCount} />
          <Metric label="Internal" value={summary.internalEdgeCount} />
          <Metric label="External" value={summary.externalEdgeCount} />
        </dl>
        <p className="eog-node__footnote">
          {hiddenCount > 0
            ? `${formatCount(hiddenCount)} of its nodes are hidden by the current filters or scope. `
            : ''}
          Internal and external count the relations that are drawn.
        </p>
      </div>

      {summary.visibleCount === 0 ? (
        <p className="eog-node__status" role="status">
          None of its nodes is drawn in the current view.
        </p>
      ) : (
        <>
          <Section title="Projects" count={details.projects.length}>
            <CountedRows items={details.projects} labelOf={projectLabel} />
          </Section>
          <Section title="Folders" count={details.folders.length} defaultOpen={false}>
            <CountedRows items={details.folders.slice(0, LISTED_FOLDERS)} labelOf={folderPathLabel} />
            {details.folders.length > LISTED_FOLDERS && (
              <p className="eog-label eog-list-note">
                Top {LISTED_FOLDERS} of {formatCount(details.folders.length)}
              </p>
            )}
          </Section>
          <Section title="Key nodes" count={details.keyNodes.length}>
            <ul onKeyDown={moveBetweenRows}>
              {details.keyNodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="eog-row"
                    aria-label={`Enter the community at ${node.label}`}
                    onClick={() => revealNode(node.id)}
                  >
                    <span className="eog-row__name">{node.label}</span>
                    <span className="eog-row__value">{formatCount(node.degree)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Connected communities" count={details.connected.length}>
            {details.connected.length === 0 ? (
              <p className="eog-relgroup__none">No drawn relation leaves this community.</p>
            ) : (
              <ul onKeyDown={moveBetweenRows}>
                {details.connected.slice(0, LISTED_COMMUNITIES).map(({ community: other, count }) => (
                  <li key={other.id}>
                    <button
                      type="button"
                      className="eog-row"
                      aria-label={`Go to community ${other.name}, ${formatCount(count)} shared relations`}
                      onClick={() => open(other.id)}
                    >
                      <span
                        className="eog-swatch"
                        style={{ background: communityColor(other.id) }}
                        aria-hidden="true"
                      />
                      <span className="eog-row__name">{other.name}</span>
                      <span className="eog-row__value">{formatCount(count)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <div className="eog-node__actions">
        <div className="eog-node__buttons">
          <HudButton label="Focus this community" onClick={() => commands.focusCommunity(community.id)}>
            <TargetIcon />
            Focus
          </HudButton>
          <HudButton
            label="Expand: draw the nodes of this community"
            disabled={!isCollapsed}
            onClick={() => setCommunityCollapsed(community.id, false)}
          >
            Expand
          </HudButton>
          <HudButton
            label="Collapse: draw this community as one aggregate"
            disabled={isCollapsed}
            onClick={() => setCommunityCollapsed(community.id, true)}
          >
            Collapse
          </HudButton>
        </div>
        <div className="eog-node__buttons">
          <HudButton
            label={isIsolated ? 'Show the rest of the graph again' : 'Show only this community'}
            pressed={isIsolated}
            onClick={() => setActiveCommunity(isIsolated ? null : community.id)}
          >
            Only this
          </HudButton>
          <HudButton label="Clear selection" onClick={() => selectCommunity(null)}>
            Clear
          </HudButton>
        </div>
      </div>
    </>
  )
}
