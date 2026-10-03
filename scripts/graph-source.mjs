// Where the build, the dev server, check:dist and the contract tests read graph.json from.
// One rule for all of them, so they can never disagree.
//
// 1. EOG_GRAPH_JSON, when set: an explicit choice always wins.
// 2. ../graphify-out/graph.json, when it exists: Graphify's live output, on the
//    machine where Graphify runs. It is only ever READ.
// 3. graph-snapshot/graph.json: the copy versioned with the app. It is what a
//    fresh clone, another computer and CI use, since graphify-out/ is not part
//    of the repository.
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const LIVE_GRAPH = resolve(APP_ROOT, '..', 'graphify-out', 'graph.json')
export const SNAPSHOT_GRAPH = resolve(APP_ROOT, 'graph-snapshot', 'graph.json')

/** @returns {{ path: string, origin: 'EOG_GRAPH_JSON' | 'graphify-out' | 'snapshot' }} */
export function resolveGraphSource(env = process.env) {
  const explicit = env.EOG_GRAPH_JSON
  if (explicit) return { path: isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit), origin: 'EOG_GRAPH_JSON' }
  if (existsSync(LIVE_GRAPH)) return { path: LIVE_GRAPH, origin: 'graphify-out' }
  return { path: SNAPSHOT_GRAPH, origin: 'snapshot' }
}
