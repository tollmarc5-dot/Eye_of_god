import { isNodeInScope, NO_PROJECT, passesFilters, projectKeyOf, ROOT_FOLDER, topFolderOf } from '@/graph'
import type { Community, GraphFilters, GraphModel, GraphScope, InternalNode } from '@/types/graph'

export { NO_PROJECT }

export interface CountedItem {
  readonly name: string
  readonly count: number
}

export const NO_PROJECT_LABEL = '(root / external)'
export const ROOT_FOLDER_LABEL = '(files at project root)'

export function projectLabel(name: string): string {
  return name === NO_PROJECT ? NO_PROJECT_LABEL : name
}

export function folderLabel(name: string): string {
  return name === ROOT_FOLDER ? ROOT_FOLDER_LABEL : name
}

function sortByCount(counts: ReadonlyMap<string, number>): CountedItem[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function increment<Key>(counts: Map<Key, number>, key: Key): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function tally(nodes: readonly InternalNode[], keyOf: (node: InternalNode) => string): CountedItem[] {
  const counts = new Map<string, number>()
  for (const node of nodes) increment(counts, keyOf(node))
  return sortByCount(counts)
}

export function listProjects(nodes: readonly InternalNode[]): CountedItem[] {
  return tally(nodes, projectKeyOf)
}

/** First-level folders inside a project, by number of nodes. */
export function listFolders(nodes: readonly InternalNode[], project: string): CountedItem[] {
  return tally(
    nodes.filter((node) => projectKeyOf(node) === project),
    topFolderOf,
  )
}

export interface CommunityRow {
  readonly community: Community
  /** Members that are drawn with the current filters and scope. */
  readonly visibleSize: number
}

/** Communities with at least one visible member, largest first. */
export function listCommunities(
  communities: readonly Community[],
  hideThirdParty: boolean,
  limit: number,
): { readonly rows: CommunityRow[]; readonly total: number } {
  const rows = communities
    .map((community) => ({
      community,
      visibleSize: hideThirdParty ? community.size - community.thirdPartyCount : community.size,
    }))
    .filter((row) => row.visibleSize > 0)
    .sort((a, b) => b.visibleSize - a.visibleSize || a.community.id - b.community.id)
  return { rows: rows.slice(0, limit), total: rows.length }
}

export interface ExplorerFacets {
  readonly projects: readonly CountedItem[]
  /** Empty while no project is active. */
  readonly folders: readonly CountedItem[]
  readonly communities: readonly CommunityRow[]
  /** Best connected nodes of what is drawn, for jumping straight to them. */
  readonly keyNodes: readonly InternalNode[]
  readonly visibleCount: number
}

/** A facet always lists its active item, even at zero, so it can be switched off. */
function withActive(items: CountedItem[], active: string | null): CountedItem[] {
  if (active === null || items.some((item) => item.name === active)) return items
  return [...items, { name: active, count: 0 }]
}

/**
 * Counts for every explorer list in one pass. Each list counts the nodes that
 * pass the filters and the OTHER parts of the scope, i.e. what would be drawn
 * if that row were picked.
 */
export function buildExplorerFacets(
  model: GraphModel,
  filters: GraphFilters,
  scope: GraphScope,
  keyNodeLimit: number,
): ExplorerFacets {
  const projectCounts = new Map<string, number>()
  const folderCounts = new Map<string, number>()
  const communityCounts = new Map<number, number>()
  const visible: InternalNode[] = []
  for (const node of model.nodes) {
    if (!passesFilters(node, filters)) continue
    if (isNodeInScope(node, { ...scope, project: null, folder: null })) {
      increment(projectCounts, projectKeyOf(node))
    }
    if (scope.project !== null && isNodeInScope(node, { ...scope, folder: null })) {
      increment(folderCounts, topFolderOf(node))
    }
    if (node.community !== null && isNodeInScope(node, { ...scope, community: null })) {
      increment(communityCounts, node.community)
    }
    if (isNodeInScope(node, scope)) visible.push(node)
  }
  const communities = model.communities
    .map((community) => ({ community, visibleSize: communityCounts.get(community.id) ?? 0 }))
    .filter((row) => row.visibleSize > 0 || row.community.id === scope.community)
    .sort((a, b) => b.visibleSize - a.visibleSize || a.community.id - b.community.id)
  const keyNodes = [...visible]
    .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1))
    .slice(0, keyNodeLimit)
  return {
    projects: withActive(sortByCount(projectCounts), scope.project),
    folders: scope.project === null ? [] : withActive(sortByCount(folderCounts), scope.folder),
    communities,
    keyNodes,
    visibleCount: visible.length,
  }
}
