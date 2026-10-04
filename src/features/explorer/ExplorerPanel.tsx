import { useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_FILTERS, isScopeActive, type GraphIndex } from '@/graph'
import { useScope } from '@/state/selectors'
import { useAppStore } from '@/state/store'
import type { GraphModel } from '@/types/graph'
import { useGraphCommands } from '@/features/world/graph-commands'
import { CloseIcon, IsolateIcon } from '@/ui/icons'
import {
  EmptyState,
  formatCount,
  HudButton,
  moveBetweenRows,
  Panel,
  Section,
  Switch,
} from '@/ui/primitives'
import { communityColor } from '@/utils/color'
import {
  buildExplorerFacets,
  folderLabel,
  projectLabel,
  type CountedItem,
} from './explorer-data'

const COMMUNITY_ROWS = 30
const KEY_NODE_ROWS = 12

interface RowProps {
  readonly isActive: boolean
  /** The selected node lives here: context, not a filter. */
  readonly holdsSelection?: boolean
  readonly isDimmed?: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}

function ScopeRow({ isActive, holdsSelection = false, isDimmed = false, onToggle, children }: RowProps) {
  return (
    <li>
      <button
        type="button"
        className="eog-row"
        aria-pressed={isActive}
        data-dimmed={isDimmed}
        data-holds-selection={holdsSelection}
        onClick={onToggle}
      >
        {children}
        {holdsSelection && <span className="eog-sr-only">, contains the selected node</span>}
      </button>
    </li>
  )
}

interface CountedListProps {
  readonly items: readonly CountedItem[]
  readonly activeName: string | null
  readonly selectionName: string | null
  readonly labelOf: (name: string) => string
  readonly onSelect: (name: string | null) => void
}

function CountedList({ items, activeName, selectionName, labelOf, onSelect }: CountedListProps) {
  return (
    <ul onKeyDown={moveBetweenRows}>
      {items.map((item) => (
        <ScopeRow
          key={item.name}
          isActive={item.name === activeName}
          holdsSelection={item.name === selectionName}
          onToggle={() => onSelect(item.name === activeName ? null : item.name)}
        >
          <span className="eog-row__name">{labelOf(item.name)}</span>
          <span className="eog-row__value">{formatCount(item.count)}</span>
        </ScopeRow>
      ))}
    </ul>
  )
}

interface ScopeChipProps {
  readonly kind: string
  readonly name: string
  readonly onClear: () => void
}

function ScopeChip({ kind, name, onClear }: ScopeChipProps) {
  return (
    <li className="eog-chip">
      <span className="eog-label">{kind}</span>
      <span className="eog-chip__name">{name}</span>
      <button type="button" className="eog-chip__clear" aria-label={`Clear ${kind.toLowerCase()} ${name}`} onClick={onClear}>
        <CloseIcon size={12} />
      </button>
    </li>
  )
}

interface ExplorerPanelProps {
  readonly model: GraphModel
  readonly index: GraphIndex
}

/**
 * Left HUD panel: decides WHAT PART of the graph is drawn (scope + filters).
 * Rows toggle the scope; only the "Key nodes" list selects a node to inspect.
 * Everything goes through the store, which the renderer and inspector follow.
 */
export function ExplorerPanel({ model, index }: ExplorerPanelProps) {
  const isOpen = useAppStore((state) => state.panels.explorer)
  const setPanel = useAppStore((state) => state.setPanel)
  const filters = useAppStore((state) => state.filters)
  const setFilters = useAppStore((state) => state.setFilters)
  const showEdges = useAppStore((state) => state.preferences.showEdges)
  const setPreferences = useAppStore((state) => state.setPreferences)
  const setActiveProject = useAppStore((state) => state.setActiveProject)
  const setActiveFolder = useAppStore((state) => state.setActiveFolder)
  const setActiveCommunity = useAppStore((state) => state.setActiveCommunity)
  const clearScope = useAppStore((state) => state.clearScope)
  const resetExploration = useAppStore((state) => state.resetExploration)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const revealNode = useAppStore((state) => state.revealNode)
  const selectedCommunityId = useAppStore((state) => state.selectedCommunityId)
  const selectCommunity = useAppStore((state) => state.selectCommunity)
  const isCommunityMode = useAppStore((state) => state.aggregation.mode === 'communities')
  const setCommunityMode = useAppStore((state) => state.setCommunityMode)
  const commands = useGraphCommands()
  const scope = useScope()
  const [showsAllCommunities, setShowsAllCommunities] = useState(false)

  const facets = useMemo(
    () => buildExplorerFacets(model, filters, scope, KEY_NODE_ROWS),
    [model, filters, scope],
  )
  const selectedNode = selectedNodeId ? index.nodeById.get(selectedNodeId) : undefined
  const activeCommunity = model.communities.find((community) => community.id === scope.community)
  const hasScope = isScopeActive(scope)
  const isGlobal =
    !hasScope &&
    showEdges &&
    filters.hideThirdParty === DEFAULT_FILTERS.hideThirdParty &&
    filters.hideIsolated === DEFAULT_FILTERS.hideIsolated
  const communityRows = showsAllCommunities
    ? facets.communities
    : facets.communities.filter(
        (row, position) =>
          position < COMMUNITY_ROWS ||
          row.community.id === scope.community ||
          row.community.id === selectedCommunityId,
      )

  return (
    <Panel
      title="Explorer"
      className="eog-explorer"
      isOpen={isOpen}
      actions={
        <HudButton
          label="Collapse explorer"
          iconOnly
          tooltipSide="bottom"
          tooltipAlign="end"
          onClick={() => setPanel('explorer', false)}
        >
          <CloseIcon size={14} />
        </HudButton>
      }
    >
      <div className="eog-scope" data-active={hasScope}>
        <div className="eog-scope__head">
          <span className="eog-label">Active scope</span>
          <span className="eog-scope__count">
            {formatCount(facets.visibleCount)} / {formatCount(model.metadata.nodeCount)} nodes
          </span>
        </div>
        {hasScope ? (
          <>
            <ul className="eog-scope__chips">
              {scope.project !== null && (
                <ScopeChip kind="Project" name={projectLabel(scope.project)} onClear={() => setActiveProject(null)} />
              )}
              {scope.folder !== null && (
                <ScopeChip kind="Folder" name={folderLabel(scope.folder)} onClear={() => setActiveFolder(null)} />
              )}
              {activeCommunity && (
                <ScopeChip kind="Community" name={activeCommunity.name} onClear={() => setActiveCommunity(null)} />
              )}
            </ul>
            <button type="button" className="eog-link" onClick={clearScope}>
              Clear scope
            </button>
          </>
        ) : (
          <p className="eog-scope__global">Whole graph</p>
        )}
      </div>

      <Section anchor="projects" title="Projects" count={facets.projects.length}>
        <CountedList
          items={facets.projects}
          activeName={scope.project}
          selectionName={selectedNode ? (selectedNode.project ?? '') : null}
          labelOf={projectLabel}
          onSelect={setActiveProject}
        />
      </Section>

      <Section title="Folders" count={scope.project === null ? undefined : facets.folders.length}>
        {scope.project === null ? (
          <EmptyState compact title="No project selected" hint="Pick a project to list its folders." />
        ) : (
          <CountedList
            items={facets.folders}
            activeName={scope.folder}
            selectionName={null}
            labelOf={folderLabel}
            onSelect={setActiveFolder}
          />
        )}
      </Section>

      <Section anchor="communities" title="Communities" count={facets.communities.length}>
        <Switch label="Community view" checked={isCommunityMode} onChange={setCommunityMode} />
        {facets.communities.length === 0 ? (
          <EmptyState compact title="No communities" hint="Nothing matches the current filters." />
        ) : (
          <ul onKeyDown={moveBetweenRows}>
            {communityRows.map(({ community, visibleSize }) => (
              <li key={community.id} className="eog-row-pair">
                {/* Selecting inspects and frames the community; it hides nothing. */}
                <button
                  type="button"
                  className="eog-row"
                  aria-current={community.id === selectedCommunityId ? 'true' : undefined}
                  data-dimmed={community.thirdPartyCount === community.size}
                  data-holds-selection={selectedNode?.community === community.id}
                  onClick={() => {
                    selectCommunity(community.id)
                    commands.focusCommunity(community.id)
                  }}
                >
                  <span
                    className="eog-swatch"
                    style={{ background: communityColor(community.id) }}
                    aria-hidden="true"
                  />
                  <span className="eog-row__name">{community.name}</span>
                  <span className="eog-row__value">{formatCount(visibleSize)}</span>
                  {selectedNode?.community === community.id && (
                    <span className="eog-sr-only">, contains the selected node</span>
                  )}
                </button>
                {/* The filter is a separate, explicit control. */}
                <button
                  type="button"
                  className="eog-row-action"
                  aria-pressed={community.id === scope.community}
                  aria-label={`Show only ${community.name}`}
                  onClick={() => setActiveCommunity(community.id === scope.community ? null : community.id)}
                >
                  <IsolateIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {facets.communities.length > COMMUNITY_ROWS && (
          <button
            type="button"
            className="eog-link eog-list-note"
            aria-expanded={showsAllCommunities}
            onClick={() => setShowsAllCommunities((shown) => !shown)}
          >
            {showsAllCommunities
              ? `Show top ${COMMUNITY_ROWS}`
              : `Show all ${formatCount(facets.communities.length)}`}
          </button>
        )}
      </Section>

      <Section anchor="key-nodes" title="Key nodes" count={facets.keyNodes.length}>
        {facets.keyNodes.length === 0 ? (
          <EmptyState compact title="No nodes in view" hint="Clear the scope or relax the filters." />
        ) : (
          <ul onKeyDown={moveBetweenRows}>
            {facets.keyNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="eog-row"
                  aria-current={node.id === selectedNodeId ? 'true' : undefined}
                  aria-label={`Inspect ${node.label}`}
                  onClick={() => revealNode(node.id)}
                >
                  <span
                    className="eog-swatch"
                    style={{ background: communityColor(node.community) }}
                    aria-hidden="true"
                  />
                  <span className="eog-row__name">{node.label}</span>
                  <span className="eog-row__value">{formatCount(node.degree)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section anchor="filters" title="Filters">
        <Switch
          label="Third-party code"
          checked={!filters.hideThirdParty}
          onChange={(checked) => setFilters({ hideThirdParty: !checked })}
        />
        <Switch
          label="Isolated nodes"
          checked={!filters.hideIsolated}
          onChange={(checked) => setFilters({ hideIsolated: !checked })}
        />
        <Switch
          label="Relations"
          checked={showEdges}
          onChange={(checked) => setPreferences({ showEdges: checked })}
        />
        <button type="button" className="eog-link eog-list-note" disabled={isGlobal} onClick={resetExploration}>
          Reset filters and scope
        </button>
      </Section>
    </Panel>
  )
}
