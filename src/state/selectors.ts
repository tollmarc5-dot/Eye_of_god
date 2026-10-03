import { useMemo } from 'react'
import {
  computeVisibility,
  describeCommunity,
  expandNeighborhood,
  summarizeCommunities,
  type CommunityDetails,
  type CommunitySummary,
  findPath,
  type Expansion,
  type GraphIndex,
  type GraphPath,
  type KnowledgeGraph,
  type Visibility,
} from '@/graph'
import type { GraphFilters, GraphModel, GraphScope } from '@/types/graph'
import { useAppStore } from './store'

/** Stable scope object: only changes identity when one of its parts does. */
export function useScope(): GraphScope {
  const project = useAppStore((state) => state.activeProject)
  const folder = useAppStore((state) => state.activeFolder)
  const community = useAppStore((state) => state.activeCommunity)
  return useMemo(() => ({ project, folder, community }), [project, folder, community])
}

interface VisibilityCache {
  readonly model: GraphModel
  readonly filters: GraphFilters
  readonly project: string | null
  readonly folder: string | null
  readonly community: number | null
  readonly value: Visibility
}

let cache: VisibilityCache | null = null

/**
 * What is drawn for the current filters and scope. Derived, never stored, and
 * computed once per change however many components ask for it.
 */
export function selectVisibility(model: GraphModel, filters: GraphFilters, scope: GraphScope): Visibility {
  if (
    cache &&
    cache.model === model &&
    cache.filters === filters &&
    cache.project === scope.project &&
    cache.folder === scope.folder &&
    cache.community === scope.community
  ) {
    return cache.value
  }
  const value = computeVisibility(model, filters, scope)
  cache = { model, filters, ...scope, value }
  return value
}

export function useVisibility(model: GraphModel): Visibility {
  const filters = useAppStore((state) => state.filters)
  const scope = useScope()
  return useMemo(() => selectVisibility(model, filters, scope), [model, filters, scope])
}

/** The node set of the active expansion, or null when there is none (or its root is not drawn). */
export function useExpansion(model: GraphModel, graph: KnowledgeGraph): Expansion | null {
  const request = useAppStore((state) => state.expansion)
  const visibleNodeIds = useVisibility(model).nodeIds
  return useMemo(
    () =>
      request
        ? expandNeighborhood(graph, request.rootId, request.depth, { allowedNodeIds: visibleNodeIds })
        : null,
    [graph, request, visibleNodeIds],
  )
}

/** State of the "path to" mode with the path worked out against what is drawn. */
export type PathView =
  | { readonly status: 'idle' }
  | { readonly status: 'picking'; readonly fromId: string }
  | { readonly status: 'found'; readonly fromId: string; readonly toId: string; readonly path: GraphPath }
  | {
      readonly status: 'none'
      readonly fromId: string
      readonly toId: string
      /** True when a path does exist, but only through nodes the view hides. */
      readonly existsOutsideView: boolean
    }

const IDLE_PATH: PathView = { status: 'idle' }

/**
 * The path follows the filters and the scope: it only runs through drawn
 * nodes, and is recomputed, never stored, when they change.
 */
export function usePathView(model: GraphModel, graph: KnowledgeGraph, index: GraphIndex): PathView {
  const request = useAppStore((state) => state.path)
  const visibleNodeIds = useVisibility(model).nodeIds
  return useMemo(() => {
    if (request.status === 'idle') return IDLE_PATH
    if (request.status === 'picking') return request
    const { fromId, toId } = request
    const path = findPath(graph, index, fromId, toId, visibleNodeIds)
    if (path) return { status: 'found', fromId, toId, path }
    return { status: 'none', fromId, toId, existsOutsideView: findPath(graph, index, fromId, toId) !== null }
  }, [graph, index, request, visibleNodeIds])
}

/** Per-community figures for the current view; recomputed only when the visibility changes. */
export function useCommunitySummaries(
  model: GraphModel,
  index: GraphIndex,
): ReadonlyMap<number, CommunitySummary> {
  const visibleNodeIds = useVisibility(model).nodeIds
  return useMemo(() => summarizeCommunities(model, index, visibleNodeIds), [model, index, visibleNodeIds])
}

const COMMUNITY_KEY_NODES = 8

/** Details of the selected community, or null when none is selected or it does not exist. */
export function useSelectedCommunity(model: GraphModel, index: GraphIndex): CommunityDetails | null {
  const communityId = useAppStore((state) => state.selectedCommunityId)
  const visibleNodeIds = useVisibility(model).nodeIds
  const summaries = useCommunitySummaries(model, index)
  return useMemo(
    () =>
      communityId === null
        ? null
        : describeCommunity(model, index, summaries, communityId, visibleNodeIds, COMMUNITY_KEY_NODES),
    [model, index, summaries, communityId, visibleNodeIds],
  )
}
