import type { GraphModel } from '@/types/graph'
import { adaptGraphify, type AdapterOptions } from './adapter'
import { GraphLoadError } from './errors'

// Served by the `graphify-source` plugin in vite.config.ts.
const GRAPH_DATA_PATH = 'data/graph.json'

export function graphDataUrl(): string {
  return `${import.meta.env.BASE_URL}${GRAPH_DATA_PATH}`
}

/**
 * Fetches and parses graph.json. The result is untrusted: hand it straight to
 * adaptGraphify and do not keep a reference to it.
 * @throws {GraphLoadError} on network / JSON failures.
 */
export async function fetchGraphJson(
  url: string = graphDataUrl(),
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response
  try {
    // "no-cache" = always ask the server whether the graph changed. A host that
    // sends no cache headers must never leave a visitor on yesterday's graph.
    response = await fetch(url, { signal, cache: 'no-cache' })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new GraphLoadError(`Could not fetch ${url}`, { cause })
  }
  if (!response.ok) {
    throw new GraphLoadError(`Could not fetch ${url}: HTTP ${response.status}`)
  }
  try {
    return (await response.json()) as unknown
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new GraphLoadError(`${url} is not valid JSON`, { cause })
  }
}

/**
 * Fetches graph.json and adapts it to the internal model.
 * @throws {GraphLoadError} on network / JSON failures.
 * @throws {GraphifySchemaError} when the schema changed.
 */
export async function loadGraphModel(
  url: string = graphDataUrl(),
  options: AdapterOptions & { signal?: AbortSignal } = {},
): Promise<GraphModel> {
  return adaptGraphify(await fetchGraphJson(url, options.signal), options)
}
