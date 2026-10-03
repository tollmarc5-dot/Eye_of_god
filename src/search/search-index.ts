import type { GraphModel, InternalNode } from '@/types/graph'
import { normalizeText, tokenize } from './normalize'

export type SearchField = 'label' | 'file' | 'path' | 'community' | 'kind'

export interface SearchHit {
  readonly node: InternalNode
  readonly score: number
  /** Field that matched best, so the UI can say why a node is in the list. */
  readonly matchedField: SearchField
}

export interface SearchResults {
  readonly hits: readonly SearchHit[]
  /** Matches before the limit was applied. */
  readonly total: number
}

export interface SearchIndex {
  readonly size: number
  search(query: string, limit?: number): SearchResults
}

interface Entry {
  readonly node: InternalNode
  /** Display label and Graphify's norm_label: both are searched as "label". */
  readonly labels: readonly string[]
  readonly fileName: string
  readonly path: string
  readonly community: string
  readonly kinds: readonly string[]
  /** Every field joined: one cheap check rejects most entries. */
  readonly haystack: string
}

export const DEFAULT_SEARCH_LIMIT = 20
export const EMPTY_RESULTS: SearchResults = { hits: [], total: 0 }

const SCORE = {
  labelExact: 100,
  labelPrefix: 80,
  labelWordStart: 70,
  labelContains: 60,
  fileName: 45,
  path: 35,
  community: 25,
  kind: 20,
} as const

const WORD_CHARACTER = /[\p{L}\p{N}]/u

function startsWord(text: string, at: number): boolean {
  return at === 0 || !WORD_CHARACTER.test(text.charAt(at - 1))
}

function scoreLabel(label: string, token: string): number {
  const at = label.indexOf(token)
  if (at < 0) return 0
  if (label.length === token.length) return SCORE.labelExact
  if (at === 0) return SCORE.labelPrefix
  return startsWord(label, at) ? SCORE.labelWordStart : SCORE.labelContains
}

interface FieldScore {
  readonly score: number
  readonly field: SearchField
}

const NO_MATCH: FieldScore = { score: 0, field: 'label' }

function scoreToken(entry: Entry, token: string): FieldScore {
  if (!entry.haystack.includes(token)) return NO_MATCH
  let labelScore = 0
  for (const label of entry.labels) labelScore = Math.max(labelScore, scoreLabel(label, token))
  if (labelScore > 0) return { score: labelScore, field: 'label' }
  if (entry.fileName.includes(token)) return { score: SCORE.fileName, field: 'file' }
  if (entry.path.includes(token)) return { score: SCORE.path, field: 'path' }
  if (entry.community.includes(token)) return { score: SCORE.community, field: 'community' }
  if (entry.kinds.includes(token)) return { score: SCORE.kind, field: 'kind' }
  return NO_MATCH
}

function scoreEntry(entry: Entry, tokens: readonly string[]): SearchHit | null {
  let total = 0
  let best: FieldScore = NO_MATCH
  for (const token of tokens) {
    const match = scoreToken(entry, token)
    if (match.score === 0) return null
    total += match.score
    if (match.score > best.score) best = match
  }
  return { node: entry.node, score: total, matchedField: best.field }
}

/** Best score first; ties go to the better connected node, then to the id. */
function compareHits(a: SearchHit, b: SearchHit): number {
  return b.score - a.score || b.node.degree - a.node.degree || (a.node.id < b.node.id ? -1 : 1)
}

function toEntry(node: InternalNode, communityName: string): Entry {
  const labels = [...new Set([normalizeText(node.label), normalizeText(node.searchLabel)])]
  const fileName = normalizeText(node.fileName)
  const path = normalizeText(node.sourceFile)
  const community = normalizeText(communityName)
  const kinds = [normalizeText(node.kind), node.extension].filter(Boolean)
  return {
    node,
    labels,
    fileName,
    path,
    community,
    kinds,
    haystack: [...labels, path, community, ...kinds].join('\n'),
  }
}

/**
 * In-memory search over the internal model, built once per model. It knows
 * nothing about the renderer or the UI. A query that extends the previous one
 * only re-checks the previous matches, so typing never rescans every node.
 */
export function buildSearchIndex(model: GraphModel): SearchIndex {
  const communityNames = new Map(model.communities.map((community) => [community.id, community.name]))
  const entries = model.nodes.map((node) =>
    toEntry(node, node.community === null ? '' : (communityNames.get(node.community) ?? '')),
  )
  let lastKey = ''
  let lastMatches: readonly Entry[] = entries

  return {
    size: entries.length,
    search(query, limit = DEFAULT_SEARCH_LIMIT) {
      const tokens = tokenize(query)
      if (tokens.length === 0) return EMPTY_RESULTS
      const key = tokens.join(' ')
      const candidates = lastKey !== '' && key.startsWith(lastKey) ? lastMatches : entries
      const matches: Entry[] = []
      const hits: SearchHit[] = []
      for (const entry of candidates) {
        const hit = scoreEntry(entry, tokens)
        if (!hit) continue
        matches.push(entry)
        hits.push(hit)
      }
      lastKey = key
      lastMatches = matches
      return { hits: hits.sort(compareHits).slice(0, limit), total: hits.length }
    },
  }
}
