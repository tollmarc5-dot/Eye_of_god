import type {
  Community,
  GraphMetadata,
  GraphModel,
  Hyperedge,
  InternalEdge,
  InternalNode,
} from '@/types/graph'
import { parsePath } from '@/utils/path'
import { parseGraphify, type GraphifyGraph, type GraphifyLink, type GraphifyNode } from './graphify-schema'
import { DEFAULT_THIRD_PARTY_PATTERNS, isThirdPartyPath } from './third-party'

export interface AdapterOptions {
  readonly thirdPartyPatterns?: readonly RegExp[]
}

interface DegreeCount {
  in: number
  out: number
}

// Graphify stores paths as the filesystem gives them (NFD on macOS) while ids
// and typed text are NFC; everything user-visible is normalised to NFC.
const nfc = (text: string): string => text.normalize('NFC')

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyOf(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function countDegrees(links: readonly GraphifyLink[]): Map<string, DegreeCount> {
  const degrees = new Map<string, DegreeCount>()
  const entry = (id: string): DegreeCount => {
    const existing = degrees.get(id)
    if (existing) return existing
    const created = { in: 0, out: 0 }
    degrees.set(id, created)
    return created
  }
  for (const link of links) {
    entry(link.source).out += 1
    entry(link.target).in += 1
  }
  return degrees
}

function toInternalNode(
  raw: GraphifyNode,
  degree: DegreeCount | undefined,
  patterns: readonly RegExp[],
): InternalNode {
  const sourceFile = nfc(raw.source_file)
  const inDegree = degree?.in ?? 0
  const outDegree = degree?.out ?? 0
  return {
    id: raw.id,
    label: nfc(raw.label),
    searchLabel: nfc(raw.norm_label),
    kind: raw.file_type,
    community: raw.community,
    sourceFile,
    sourceLocation: raw.source_location ?? null,
    ...parsePath(sourceFile),
    origin: raw._origin ?? null,
    rationale: raw.rationale ?? null,
    isCallable: raw._callable === true,
    isExternal: raw.external === true,
    isThirdParty: isThirdPartyPath(sourceFile, patterns),
    degree: inDegree + outDegree,
    inDegree,
    outDegree,
  }
}

function toInternalEdges(links: readonly GraphifyLink[]): InternalEdge[] {
  const seen = new Map<string, number>()
  return links.map((link) => {
    const baseId = `${link.source}|${link.relation}|${link.target}`
    const repeats = seen.get(baseId) ?? 0
    seen.set(baseId, repeats + 1)
    return {
      id: repeats === 0 ? baseId : `${baseId}#${repeats}`,
      source: link.source,
      target: link.target,
      relation: link.relation,
      confidence: link.confidence,
      confidenceScore: link.confidence_score,
      weight: link.weight,
      context: link.context ?? null,
      origin: link._origin ?? null,
      sourceFile: nfc(link.source_file),
      sourceLocation: link.source_location ?? null,
      isSelfLoop: link.source === link.target,
    }
  })
}

function pickHub(members: readonly InternalNode[]): InternalNode {
  return members.reduce((best, node) =>
    node.degree > best.degree || (node.degree === best.degree && node.id < best.id) ? node : best,
  )
}

/**
 * Technical fallback while Graphify provides no labels. Swapping in semantic
 * names later only means feeding `community_name` (or changing this function).
 */
function placeholderCommunityName(id: number): string {
  return `Community ${id}`
}

function buildCommunities(nodes: readonly InternalNode[], rawNodes: readonly GraphifyNode[]): Community[] {
  const members = new Map<number, InternalNode[]>()
  const graphifyNames = new Map<number, string>()
  nodes.forEach((node, index) => {
    if (node.community === null) return
    const list = members.get(node.community) ?? []
    list.push(node)
    members.set(node.community, list)
    const rawName = rawNodes[index]?.community_name
    // "Community 12" is Graphify's own placeholder, not a real label.
    if (rawName && rawName !== placeholderCommunityName(node.community)) {
      graphifyNames.set(node.community, nfc(rawName))
    }
  })
  return [...members.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, list]) => {
      const hub = pickHub(list)
      const graphifyName = graphifyNames.get(id)
      return {
        id,
        name: graphifyName ?? placeholderCommunityName(id),
        nameSource: graphifyName ? ('graphify' as const) : ('placeholder' as const),
        size: list.length,
        hubNodeId: hub.id,
        thirdPartyCount: list.filter((node) => node.isThirdParty).length,
      }
    })
}

function buildMetadata(
  graph: GraphifyGraph,
  nodes: readonly InternalNode[],
  edges: readonly InternalEdge[],
  communityCount: number,
): GraphMetadata {
  const thirdPartyIds = new Set(nodes.filter((node) => node.isThirdParty).map((node) => node.id))
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    communityCount,
    isolatedNodeCount: nodes.filter((node) => node.degree === 0).length,
    selfLoopCount: edges.filter((edge) => edge.isSelfLoop).length,
    thirdPartyNodeCount: thirdPartyIds.size,
    thirdPartyEdgeCount: edges.filter(
      (edge) => thirdPartyIds.has(edge.source) || thirdPartyIds.has(edge.target),
    ).length,
    declaredDirected: graph.directed,
    relationCounts: countBy(edges, (edge) => edge.relation),
    kindCounts: countBy(nodes, (node) => node.kind),
    extensionCounts: countBy(nodes, (node) => node.extension),
    projectCounts: countBy(nodes, (node) => node.project ?? ''),
  }
}

/**
 * The only entry point from Graphify's format into the app.
 * Never mutates its input.
 * @throws {GraphifySchemaError} when the JSON does not match the known schema.
 */
export function adaptGraphify(raw: unknown, options: AdapterOptions = {}): GraphModel {
  const graph = parseGraphify(raw)
  const patterns = options.thirdPartyPatterns ?? DEFAULT_THIRD_PARTY_PATTERNS
  const degrees = countDegrees(graph.links)

  const nodes = graph.nodes.map((node) => toInternalNode(node, degrees.get(node.id), patterns))
  const edges = toInternalEdges(graph.links)
  const communities = buildCommunities(nodes, graph.nodes)
  const hyperedges: Hyperedge[] = (graph.hyperedges ?? []).map((hyperedge) => ({
    id: hyperedge.id,
    label: nfc(hyperedge.label),
    nodeIds: hyperedge.nodes,
    relation: hyperedge.relation ?? null,
  }))

  return {
    nodes,
    edges,
    communities,
    hyperedges,
    metadata: buildMetadata(graph, nodes, edges, communities.length),
  }
}
