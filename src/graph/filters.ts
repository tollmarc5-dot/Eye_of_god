import type { GraphFilters, GraphModel, GraphScope, InternalEdge, InternalNode } from '@/types/graph'

export const DEFAULT_FILTERS: GraphFilters = {
  hideThirdParty: true,
  hideIsolated: false,
  hiddenCommunities: [],
  kinds: null,
  relations: null,
}

export const NO_SCOPE: GraphScope = { project: null, folder: null, community: null }

/** Key of the bucket for nodes that belong to no project. */
export const NO_PROJECT = ''
/** Key of the bucket for files that sit directly at the root of a project. */
export const ROOT_FOLDER = ''

export function projectKeyOf(node: InternalNode): string {
  return node.project ?? NO_PROJECT
}

/** First-level folder of a node inside its project. */
export function topFolderOf(node: InternalNode): string {
  return node.folder.split('/')[1] ?? ROOT_FOLDER
}

export function isScopeActive(scope: GraphScope): boolean {
  return scope.project !== null || scope.folder !== null || scope.community !== null
}

export function isNodeInScope(node: InternalNode, scope: GraphScope): boolean {
  if (scope.project !== null && projectKeyOf(node) !== scope.project) return false
  if (scope.folder !== null && topFolderOf(node) !== scope.folder) return false
  if (scope.community !== null && node.community !== scope.community) return false
  return true
}

export function passesFilters(node: InternalNode, filters: GraphFilters): boolean {
  if (filters.hideThirdParty && node.isThirdParty) return false
  if (filters.hideIsolated && node.degree === 0) return false
  if (node.community !== null && filters.hiddenCommunities.includes(node.community)) return false
  if (filters.kinds && !filters.kinds.includes(node.kind)) return false
  return true
}

/** The one rule that decides whether a node is drawn: filters AND scope. */
export function isNodeVisible(
  node: InternalNode,
  filters: GraphFilters,
  scope: GraphScope = NO_SCOPE,
): boolean {
  return passesFilters(node, filters) && isNodeInScope(node, scope)
}

export function isEdgeVisible(
  edge: InternalEdge,
  filters: GraphFilters,
  visibleNodeIds: ReadonlySet<string>,
): boolean {
  if (filters.relations && !filters.relations.includes(edge.relation)) return false
  return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
}

/**
 * Filtering is a visibility mask: the graph itself is never rebuilt or
 * mutated, the renderer just skips what is not in this set.
 */
export function computeVisibleNodeIds(
  model: GraphModel,
  filters: GraphFilters,
  scope: GraphScope = NO_SCOPE,
): Set<string> {
  const ids = new Set<string>()
  for (const node of model.nodes) {
    if (isNodeVisible(node, filters, scope)) ids.add(node.id)
  }
  return ids
}

/** What is on screen for a given filters + scope, with the figures the HUD shows. */
export interface Visibility {
  readonly nodeIds: ReadonlySet<string>
  readonly edgeCount: number
  readonly communityCount: number
}

export function computeVisibility(
  model: GraphModel,
  filters: GraphFilters,
  scope: GraphScope = NO_SCOPE,
): Visibility {
  const nodeIds = new Set<string>()
  const communities = new Set<number>()
  for (const node of model.nodes) {
    if (!isNodeVisible(node, filters, scope)) continue
    nodeIds.add(node.id)
    if (node.community !== null) communities.add(node.community)
  }
  let edgeCount = 0
  for (const edge of model.edges) {
    if (isEdgeVisible(edge, filters, nodeIds)) edgeCount += 1
  }
  return { nodeIds, edgeCount, communityCount: communities.size }
}

/**
 * The smallest change to filters and scope that makes `node` visible, used
 * when something outside the current view is picked (e.g. a search result).
 * Returns the same objects when nothing has to change.
 */
export function revealNode(
  node: InternalNode,
  filters: GraphFilters,
  scope: GraphScope,
): { readonly filters: GraphFilters; readonly scope: GraphScope } {
  const nextFilters: GraphFilters = passesFilters(node, filters)
    ? filters
    : {
        ...filters,
        hideThirdParty: filters.hideThirdParty && !node.isThirdParty,
        hideIsolated: filters.hideIsolated && node.degree !== 0,
        hiddenCommunities: filters.hiddenCommunities.filter((id) => id !== node.community),
        kinds: filters.kinds && !filters.kinds.includes(node.kind) ? null : filters.kinds,
      }
  if (isNodeInScope(node, scope)) return { filters: nextFilters, scope }
  const keepsProject = scope.project === null || scope.project === projectKeyOf(node)
  const nextScope: GraphScope = {
    project: keepsProject ? scope.project : null,
    folder: keepsProject && (scope.folder === null || scope.folder === topFolderOf(node)) ? scope.folder : null,
    community: scope.community === null || scope.community === node.community ? scope.community : null,
  }
  return { filters: nextFilters, scope: nextScope }
}
