/**
 * Internal graph model. Every module outside src/data works with these types
 * only; none of them knows Graphify's raw format.
 *
 * Fields are either copied from graph.json or derived deterministically from
 * it. Nothing here is a guess about meaning.
 */

export interface InternalNode {
  readonly id: string
  readonly label: string
  /** Lowercase, diacritics stripped (Graphify's `norm_label`). */
  readonly searchLabel: string
  /** Graphify's `file_type`: code, document, concept, image, rationale… */
  readonly kind: string
  readonly community: number | null
  /** Relative path, NFC-normalised. Empty for external nodes. */
  readonly sourceFile: string
  readonly sourceLocation: string | null
  /** First path segment when the file lives inside a folder, else null. */
  readonly project: string | null
  /** Directory part of `sourceFile` ('' for root-level files). */
  readonly folder: string
  readonly fileName: string
  /** Lowercase, without the dot ('' when there is none). */
  readonly extension: string
  readonly origin: string | null
  readonly rationale: string | null
  readonly isCallable: boolean
  readonly isExternal: boolean
  readonly isThirdParty: boolean
  readonly degree: number
  readonly inDegree: number
  readonly outDegree: number
}

export interface InternalEdge {
  /** Derived: Graphify links carry no id. Stable across regenerations. */
  readonly id: string
  readonly source: string
  readonly target: string
  readonly relation: string
  readonly confidence: string
  readonly confidenceScore: number
  readonly weight: number
  readonly context: string | null
  readonly origin: string | null
  readonly sourceFile: string
  readonly sourceLocation: string | null
  readonly isSelfLoop: boolean
}

export type CommunityNameSource = 'graphify' | 'placeholder'

export interface Community {
  readonly id: number
  readonly name: string
  /** 'graphify' when a real label came with the data, 'placeholder' ("Community N") otherwise. */
  readonly nameSource: CommunityNameSource
  readonly size: number
  /** Highest-degree member (ties broken by id). */
  readonly hubNodeId: string
  readonly thirdPartyCount: number
}

export interface Hyperedge {
  readonly id: string
  readonly label: string
  readonly nodeIds: readonly string[]
  readonly relation: string | null
}

export interface GraphMetadata {
  readonly nodeCount: number
  readonly edgeCount: number
  readonly communityCount: number
  readonly isolatedNodeCount: number
  readonly selfLoopCount: number
  readonly thirdPartyNodeCount: number
  readonly thirdPartyEdgeCount: number
  /** Value of the `directed` flag in graph.json (edges keep true direction either way). */
  readonly declaredDirected: boolean
  readonly relationCounts: Readonly<Record<string, number>>
  readonly kindCounts: Readonly<Record<string, number>>
  readonly extensionCounts: Readonly<Record<string, number>>
  readonly projectCounts: Readonly<Record<string, number>>
}

export interface GraphModel {
  readonly nodes: readonly InternalNode[]
  readonly edges: readonly InternalEdge[]
  readonly communities: readonly Community[]
  readonly hyperedges: readonly Hyperedge[]
  readonly metadata: GraphMetadata
}

export interface Position {
  readonly x: number
  readonly y: number
}

/** Positions keyed by node id, so they can be cached across regenerations. */
export type PositionMap = ReadonlyMap<string, Position>

export interface GraphFilters {
  readonly hideThirdParty: boolean
  readonly hideIsolated: boolean
  readonly hiddenCommunities: readonly number[]
  /** null = every kind / relation is shown. */
  readonly kinds: readonly string[] | null
  readonly relations: readonly string[] | null
}

/**
 * The part of the graph being explored. Every field narrows the view; null
 * means "no restriction". Independent from the selected node.
 */
export interface GraphScope {
  /** '' is the bucket of root-level and external nodes. */
  readonly project: string | null
  /** First-level folder inside `project` ('' for files at its root). */
  readonly folder: string | null
  readonly community: number | null
}

export interface CameraState {
  readonly x: number
  readonly y: number
  readonly ratio: number
  readonly angle: number
}
