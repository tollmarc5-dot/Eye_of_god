import { useEffect, useMemo, useRef } from 'react'
import { useGraphCommands } from '@/features/world/graph-commands'
import { analyzeNode, EXPANSION_DEPTHS, type GraphIndex, type KnowledgeGraph } from '@/graph'
import { useExpansion, usePathView, useSelectedCommunity, useVisibility } from '@/state/selectors'
import { useAppStore } from '@/state/store'
import type { GraphModel } from '@/types/graph'
import { CloseIcon, EyeSymbol, NeighborsIcon, PathIcon, TargetIcon } from '@/ui/icons'
import { EmptyState, formatCount, HudButton, Panel } from '@/ui/primitives'
import { CommunityInspector } from './CommunityInspector'
import { NodeRelations } from './NodeRelations'
import { PathPanel } from './PathPanel'
import { NodeIdentity, NodeSummary } from './NodeSummary'

interface InspectorPanelProps {
  readonly model: GraphModel
  readonly index: GraphIndex
  /** Read-only here: adjacency queries for the selected node. */
  readonly graph: KnowledgeGraph
}

/**
 * Right HUD panel: what the selected node is, where it lives and what it is
 * connected to. It owns no selection of its own — it reads `selectedNodeId`,
 * the same value the renderer highlights, and navigates through the store.
 */
export function InspectorPanel({ model, index, graph }: InspectorPanelProps) {
  const isOpen = useAppStore((state) => state.panels.inspector)
  const setPanel = useAppStore((state) => state.setPanel)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const selectNode = useAppStore((state) => state.selectNode)
  const revealNode = useAppStore((state) => state.revealNode)
  const isAwaitingPosition = useAppStore(
    (state) => state.focusRequest !== null && state.focusRequest === state.selectedNodeId,
  )
  const selectedCommunityId = useAppStore((state) => state.selectedCommunityId)
  const selectCommunity = useAppStore((state) => state.selectCommunity)
  const communityDetails = useSelectedCommunity(model, index)
  const startPath = useAppStore((state) => state.startPath)
  const clearPath = useAppStore((state) => state.clearPath)
  const commands = useGraphCommands()
  const visibleNodeIds = useVisibility(model).nodeIds
  const expansion = useExpansion(model, graph)
  const pathView = usePathView(model, graph, index)

  const node = selectedNodeId ? index.nodeById.get(selectedNodeId) : undefined
  // Walks only this node's edges; recomputed when the selection changes.
  const analysis = useMemo(
    () => (selectedNodeId ? analyzeNode(graph, index, selectedNodeId) : null),
    [graph, index, selectedNodeId],
  )
  const communityNames = useMemo(
    () => new Map(model.communities.map((community) => [community.id, community.name])),
    [model],
  )
  const hiddenNeighborCount = useMemo(() => {
    if (!analysis) return 0
    const hidden = new Set<string>()
    for (const connection of analysis.connections) {
      if (connection.direction !== 'self' && !visibleNodeIds.has(connection.node.id)) {
        hidden.add(connection.node.id)
      }
    }
    return hidden.size
  }, [analysis, visibleNodeIds])
  const hasDrawnNeighbors = analysis !== null && analysis.neighborCount > hiddenNeighborCount

  // A new node or community starts at the top: its identity first, never mid-list.
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [selectedNodeId, selectedCommunityId])

  return (
    <Panel
      title="Node inspector"
      className="eog-inspector"
      isOpen={isOpen}
      bodyRef={bodyRef}
      actions={
        <HudButton
          label="Collapse inspector"
          iconOnly
          tooltipSide="bottom"
          tooltipAlign="end"
          onClick={() => setPanel('inspector', false)}
        >
          <CloseIcon size={14} />
        </HudButton>
      }
    >
      <PathPanel
        pathView={pathView}
        index={index}
        selectedNodeId={selectedNodeId}
        onOpen={revealNode}
        onClear={clearPath}
      />

      {communityDetails && <CommunityInspector key={communityDetails.community.id} details={communityDetails} />}

      {selectedCommunityId !== null && !communityDetails && (
        <div role="alert">
          <EmptyState
            title="Community not available"
            hint="The selected community is not part of the loaded graph."
          />
          <div className="eog-node__actions">
            <HudButton label="Clear selection" onClick={() => selectCommunity(null)}>
              Clear
            </HudButton>
          </div>
        </div>
      )}

      {selectedNodeId === null && selectedCommunityId === null && (
        <EmptyState
          title="No node selected"
          hint="Select a node to inspect it."
          mark={<EyeSymbol size={36} />}
        />
      )}

      {selectedNodeId !== null && (!node || !analysis) && (
        <div role="alert">
          <EmptyState
            title="Node not available"
            hint="The selected node is not part of the loaded graph."
          />
          <div className="eog-node__actions">
            <HudButton label="Clear selection" onClick={() => selectNode(null)}>
              Clear
            </HudButton>
          </div>
        </div>
      )}

      {node && analysis && (
        <>
          {/* Keyed by id: each selection replays the enter transition and resets list controls. */}
          <NodeIdentity key={`identity-${node.id}`} node={node} />
          <NodeSummary
            key={`summary-${node.id}`}
            node={node}
            community={model.communities.find((candidate) => candidate.id === node.community)}
            analysis={analysis}
            hiddenNeighborCount={hiddenNeighborCount}
            onOpenCommunity={(communityId) => {
              selectCommunity(communityId)
              commands.focusCommunity(communityId)
            }}
          />
          {isAwaitingPosition && (
            <p className="eog-node__status" role="status">
              Positioning node in the graph…
            </p>
          )}
          <NodeRelations
            key={`relations-${node.id}`}
            analysis={analysis}
            visibleNodeIds={visibleNodeIds}
            communityNames={communityNames}
            onOpen={revealNode}
          />
          <div className="eog-node__actions">
            <div className="eog-node__buttons">
              <HudButton label="Focus this node" onClick={() => commands.focusNode(node.id)}>
                <TargetIcon />
                Focus
              </HudButton>
              <HudButton
                label={
                  pathView.status === 'picking'
                    ? 'Path to: waiting for the destination node'
                    : 'Path to: find the connection from this node to another one'
                }
                pressed={pathView.status === 'picking'}
                onClick={pathView.status === 'picking' ? clearPath : startPath}
              >
                <PathIcon />
                Path to
              </HudButton>
              <HudButton label="Clear selection" onClick={() => selectNode(null)}>
                Clear
              </HudButton>
            </div>
            <div className="eog-expand" role="group" aria-label="Expand neighbourhood">
              <span className="eog-expand__label">
                <NeighborsIcon size={14} />
                <span className="eog-label">Expand</span>
              </span>
              <div className="eog-segmented">
                {EXPANSION_DEPTHS.map((depth) => {
                  const isActive = expansion?.rootId === node.id && expansion.depth === depth
                  return (
                    <button
                      key={depth}
                      type="button"
                      aria-pressed={isActive}
                      aria-label={`Expand to depth ${depth}${hasDrawnNeighbors ? '' : ' (no neighbours in the current view)'}`}
                      disabled={!hasDrawnNeighbors}
                      onClick={() => commands.expandNode(node.id, isActive ? null : depth)}
                    >
                      {depth}
                    </button>
                  )
                })}
              </div>
            </div>
            {expansion?.rootId === node.id && (
              <p className="eog-expand__info" role="status">
                Depth {expansion.depth} · {formatCount(expansion.nodeIds.size)} nodes
                {expansion.hiddenNeighborCount > 0 &&
                  ` · ${formatCount(expansion.hiddenNeighborCount)} outside the current view`}
                {expansion.isTruncated && ` · stopped at the limit of ${formatCount(expansion.nodeIds.size)}`}
              </p>
            )}
          </div>
        </>
      )}
    </Panel>
  )
}
