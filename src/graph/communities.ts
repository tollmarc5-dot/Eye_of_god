import type { Community, GraphModel, InternalNode } from '@/types/graph'
import type { GraphIndex, KnowledgeGraph } from './build-graph'
import { projectKeyOf, topFolderOf } from './filters'

/** What a community looks like under the current filters and scope. */
export interface CommunitySummary {
  readonly communityId: number
  /** Members that are drawn. */
  readonly visibleCount: number
  /** Drawn relations with both ends inside the community. */
  readonly internalEdgeCount: number
  /** Drawn relations that leave the community. */
  readonly externalEdgeCount: number
  /** Other community id → number of drawn relations shared with it. */
  readonly neighbors: ReadonlyMap<number, number>
}

const NO_NEIGHBORS: ReadonlyMap<number, number> = new Map()

/**
 * One pass over nodes and one over edges for ALL communities. Runs when the
 * visibility changes, never when a community is selected or collapsed.
 */
export function summarizeCommunities(
  model: GraphModel,
  index: GraphIndex,
  visibleNodeIds: ReadonlySet<string>,
): ReadonlyMap<number, CommunitySummary> {
  const visible = new Map<number, number>()
  const internal = new Map<number, number>()
  const external = new Map<number, number>()
  const neighbors = new Map<number, Map<number, number>>()
  const add = <Key>(counts: Map<Key, number>, key: Key): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const node of model.nodes) {
    if (node.community !== null && visibleNodeIds.has(node.id)) add(visible, node.community)
  }
  const link = (from: number, to: number): void => {
    add(external, from)
    let counts = neighbors.get(from)
    if (!counts) {
      counts = new Map()
      neighbors.set(from, counts)
    }
    add(counts, to)
  }
  for (const edge of model.edges) {
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue
    const from = index.nodeById.get(edge.source)?.community ?? null
    const to = index.nodeById.get(edge.target)?.community ?? null
    if (from === null || to === null) continue
    if (from === to) {
      add(internal, from)
    } else {
      link(from, to)
      link(to, from)
    }
  }
  return new Map(
    model.communities.map((community) => [
      community.id,
      {
        communityId: community.id,
        visibleCount: visible.get(community.id) ?? 0,
        internalEdgeCount: internal.get(community.id) ?? 0,
        externalEdgeCount: external.get(community.id) ?? 0,
        neighbors: neighbors.get(community.id) ?? NO_NEIGHBORS,
      },
    ]),
  )
}

export interface CountedName {
  readonly name: string
  readonly count: number
}

/** Everything the inspector shows about one community. Costs its size, not the graph's. */
export interface CommunityDetails {
  readonly community: Community
  readonly summary: CommunitySummary
  /** Every member, drawn or not. */
  readonly nodeIds: readonly string[]
  /** Projects and first-level folders of the drawn members, most populated first. */
  readonly projects: readonly CountedName[]
  readonly folders: readonly CountedName[]
  /** Best connected drawn members. */
  readonly keyNodes: readonly InternalNode[]
  /** Communities it shares drawn relations with, strongest first. */
  readonly connected: readonly { readonly community: Community; readonly count: number }[]
}

function tally(nodes: readonly InternalNode[], keyOf: (node: InternalNode) => string): CountedName[] {
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(keyOf(node), (counts.get(keyOf(node)) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Null for an id that is not a community of the loaded graph. */
export function describeCommunity(
  model: GraphModel,
  index: GraphIndex,
  summaries: ReadonlyMap<number, CommunitySummary>,
  communityId: number,
  visibleNodeIds: ReadonlySet<string>,
  keyNodeLimit: number,
): CommunityDetails | null {
  const community = model.communities.find((candidate) => candidate.id === communityId)
  const summary = summaries.get(communityId)
  const nodeIds = index.nodeIdsByCommunity.get(communityId)
  if (!community || !summary || !nodeIds) return null
  const drawn = nodeIds
    .filter((id) => visibleNodeIds.has(id))
    .map((id) => index.nodeById.get(id))
    .filter((node): node is InternalNode => node !== undefined)
  const byId = new Map(model.communities.map((candidate) => [candidate.id, candidate]))
  return {
    community,
    summary,
    nodeIds,
    projects: tally(drawn, projectKeyOf),
    folders: tally(drawn, (node) => `${projectKeyOf(node)}/${topFolderOf(node)}`),
    keyNodes: [...drawn]
      .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1))
      .slice(0, keyNodeLimit),
    connected: [...summary.neighbors.entries()]
      .map(([id, count]) => ({ community: byId.get(id), count }))
      .filter((entry): entry is { community: Community; count: number } => entry.community !== undefined)
      .sort((a, b) => b.count - a.count || a.community.id - b.community.id),
  }
}

/** How the view groups nodes: 'communities' collapses everything except the exceptions. */
export interface Aggregation {
  readonly mode: 'nodes' | 'communities'
  /** Collapsed ids in 'nodes' mode, expanded ids in 'communities' mode. */
  readonly exceptions: readonly number[]
}

export const NO_AGGREGATION: Aggregation = { mode: 'nodes', exceptions: [] }

export function isCommunityCollapsed(aggregation: Aggregation, communityId: number): boolean {
  return (aggregation.mode === 'communities') !== aggregation.exceptions.includes(communityId)
}

/** The same aggregation with one community forced collapsed or expanded. */
export function withCommunityCollapsed(
  aggregation: Aggregation,
  communityId: number,
  isCollapsed: boolean,
): Aggregation {
  if (isCommunityCollapsed(aggregation, communityId) === isCollapsed) return aggregation
  const exceptions = aggregation.exceptions.includes(communityId)
    ? aggregation.exceptions.filter((id) => id !== communityId)
    : [...aggregation.exceptions, communityId]
  return { mode: aggregation.mode, exceptions }
}

/** A collapsed community as it is drawn: one of its own nodes standing for all of them. */
export interface Aggregate {
  readonly communityId: number
  /**
   * Best connected drawn member. It is restyled and drawn where it already
   * is: nothing is added to the graph and no node is moved.
   */
  readonly representativeId: string
  /** Position of the representative, in graph coordinates. */
  readonly x: number
  readonly y: number
  readonly size: number
  readonly label: string
  readonly memberCount: number
}

const MIN_AGGREGATE_SIZE = 9
const MAX_AGGREGATE_SIZE = 34
const AGGREGATE_SIZE_PER_SQRT_MEMBER = 3.2

/** One member is a small disc, sixty a large one; never larger than the hubs of the graph allow. */
export function aggregateSize(memberCount: number): number {
  return Math.min(
    MAX_AGGREGATE_SIZE,
    MIN_AGGREGATE_SIZE + AGGREGATE_SIZE_PER_SQRT_MEMBER * Math.sqrt(Math.max(0, memberCount - 1)),
  )
}

export interface AggregateOptions {
  /** Communities with one of these nodes stay expanded: a shown path or expansion wins. */
  readonly keepExpandedFor?: ReadonlySet<string>
}

/**
 * The aggregates to draw: one per collapsed community with drawn members.
 * Purely derived from what already exists — no layout, no new nodes, no moved nodes.
 */
export function computeAggregates(
  graph: KnowledgeGraph,
  model: GraphModel,
  index: GraphIndex,
  aggregation: Aggregation,
  drawnNodeIds: ReadonlySet<string>,
  options: AggregateOptions = {},
): ReadonlyMap<number, Aggregate> {
  const aggregates = new Map<number, Aggregate>()
  if (aggregation.mode === 'nodes' && aggregation.exceptions.length === 0) return aggregates
  const pinned = new Set<number>()
  for (const nodeId of options.keepExpandedFor ?? []) {
    const community = index.nodeById.get(nodeId)?.community
    if (community !== null && community !== undefined) pinned.add(community)
  }
  for (const community of model.communities) {
    if (!isCommunityCollapsed(aggregation, community.id) || pinned.has(community.id)) continue
    let count = 0
    let representative: InternalNode | null = null
    for (const nodeId of index.nodeIdsByCommunity.get(community.id) ?? []) {
      if (!drawnNodeIds.has(nodeId)) continue
      const node = index.nodeById.get(nodeId)
      if (!node) continue
      count += 1
      if (
        !representative ||
        node.degree > representative.degree ||
        (node.degree === representative.degree && node.id < representative.id)
      ) {
        representative = node
      }
    }
    if (!representative) continue
    const { x, y } = graph.getNodeAttributes(representative.id)
    aggregates.set(community.id, {
      communityId: community.id,
      representativeId: representative.id,
      x,
      y,
      size: aggregateSize(count),
      label: `${community.name} · ${count}`,
      memberCount: count,
    })
  }
  return aggregates
}
