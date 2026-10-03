export interface SchemaIssue {
  /** Path inside graph.json, array indices collapsed: `nodes[].source_file`. */
  readonly path: string
  readonly message: string
  /** How many elements show this same problem. */
  readonly count: number
  /** One concrete location, e.g. `nodes[42].source_file`. */
  readonly example: string
}

const MAX_ISSUES_IN_MESSAGE = 8

/** graph.json does not match the schema this adapter was written for. */
export class GraphifySchemaError extends Error {
  readonly issues: readonly SchemaIssue[]

  constructor(issues: readonly SchemaIssue[]) {
    const lines = issues
      .slice(0, MAX_ISSUES_IN_MESSAGE)
      .map((issue) => `  - ${issue.path}: ${issue.message} (${issue.count}×, e.g. ${issue.example})`)
    const hidden = issues.length - lines.length
    const more = hidden > 0 ? `\n  … and ${hidden} more` : ''
    super(`graph.json does not match the expected Graphify schema:\n${lines.join('\n')}${more}`)
    this.name = 'GraphifySchemaError'
    this.issues = issues
  }
}

/** graph.json could not be fetched or is not JSON at all. */
export class GraphLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GraphLoadError'
  }
}
