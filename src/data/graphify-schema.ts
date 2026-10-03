import { z } from 'zod'
import { GraphifySchemaError, type SchemaIssue } from './errors'

/**
 * Raw Graphify format (NetworkX node-link JSON, graphify 0.9.73).
 *
 * Only fields observed in real output are declared. Objects are "loose":
 * a field Graphify ADDS later is ignored, while a declared field that goes
 * missing or changes type is a hard error.
 */

const optionalNullableString = z.string().nullable().optional()

export const graphifyNodeSchema = z.looseObject({
  id: z.string().min(1),
  label: z.string(),
  norm_label: z.string(),
  community: z.number().int().nullable(),
  file_type: z.string(),
  source_file: z.string(),
  source_location: optionalNullableString,
  // Only written when community labels exist (.graphify_labels.json).
  community_name: z.string().optional(),
  rationale: optionalNullableString,
  external: z.boolean().optional(),
  _origin: z.string().optional(),
  _callable: z.boolean().optional(),
})

export const graphifyLinkSchema = z.looseObject({
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.string(),
  confidence: z.string(),
  confidence_score: z.number(),
  weight: z.number(),
  source_file: z.string(),
  source_location: optionalNullableString,
  context: z.string().optional(),
  _origin: z.string().optional(),
})

export const graphifyHyperedgeSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  nodes: z.array(z.string()),
  relation: z.string().optional(),
})

export const graphifyGraphSchema = z.looseObject({
  directed: z.boolean(),
  multigraph: z.boolean(),
  nodes: z.array(graphifyNodeSchema),
  links: z.array(graphifyLinkSchema),
  hyperedges: z.array(graphifyHyperedgeSchema).optional(),
})

export type GraphifyNode = z.infer<typeof graphifyNodeSchema>
export type GraphifyLink = z.infer<typeof graphifyLinkSchema>
export type GraphifyHyperedge = z.infer<typeof graphifyHyperedgeSchema>
export type GraphifyGraph = z.infer<typeof graphifyGraphSchema>

type IssuePath = readonly PropertyKey[]

function formatPath(path: IssuePath, collapseIndices: boolean): string {
  return path.reduce<string>((text, key) => {
    if (typeof key === 'number') return `${text}[${collapseIndices ? '' : key}]`
    return text ? `${text}.${String(key)}` : String(key)
  }, '') || '(root)'
}

/** A schema drift usually repeats on every element: group it into one issue. */
function groupIssues(raw: readonly { path: IssuePath; message: string }[]): SchemaIssue[] {
  const grouped = new Map<string, SchemaIssue>()
  for (const issue of raw) {
    const path = formatPath(issue.path, true)
    const key = `${path}\u0000${issue.message}`
    const existing = grouped.get(key)
    grouped.set(key, {
      path,
      message: issue.message,
      count: (existing?.count ?? 0) + 1,
      example: existing?.example ?? formatPath(issue.path, false),
    })
  }
  return [...grouped.values()]
}

function checkIntegrity(graph: GraphifyGraph): SchemaIssue[] {
  const raw: { path: IssuePath; message: string }[] = []
  const ids = new Set<string>()
  graph.nodes.forEach((node, index) => {
    if (ids.has(node.id)) raw.push({ path: ['nodes', index, 'id'], message: 'duplicate node id' })
    ids.add(node.id)
  })
  graph.links.forEach((link, index) => {
    for (const end of ['source', 'target'] as const) {
      if (!ids.has(link[end])) {
        raw.push({ path: ['links', index, end], message: 'references a node id that does not exist' })
      }
    }
  })
  return groupIssues(raw)
}

/**
 * Validates untrusted JSON against the Graphify schema.
 * @throws {GraphifySchemaError} naming every part of the schema that changed.
 */
export function parseGraphify(raw: unknown): GraphifyGraph {
  const result = graphifyGraphSchema.safeParse(raw)
  if (!result.success) {
    throw new GraphifySchemaError(groupIssues(result.error.issues))
  }
  const integrityIssues = checkIntegrity(result.data)
  if (integrityIssues.length > 0) {
    throw new GraphifySchemaError(integrityIssues)
  }
  return result.data
}
