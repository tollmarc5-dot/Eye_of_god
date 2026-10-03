import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { APP_ROOT, LIVE_GRAPH, resolveGraphSource, SNAPSHOT_GRAPH } from '../scripts/graph-source.mjs'

describe('graph source', () => {
  test('an explicit EOG_GRAPH_JSON always wins, relative to the working directory', () => {
    expect(resolveGraphSource({ EOG_GRAPH_JSON: '/tmp/other.json' })).toEqual({
      path: '/tmp/other.json',
      origin: 'EOG_GRAPH_JSON',
    })
    expect(resolveGraphSource({ EOG_GRAPH_JSON: 'some/graph.json' }).path).toBe(join(process.cwd(), 'some/graph.json'))
  })

  test("Graphify's live output where it exists, the versioned snapshot everywhere else", () => {
    const source = resolveGraphSource({})

    expect(source).toEqual(
      existsSync(LIVE_GRAPH)
        ? { path: LIVE_GRAPH, origin: 'graphify-out' }
        : { path: SNAPSHOT_GRAPH, origin: 'snapshot' },
    )
  })

  // Whatever the folder of the clone is called (CI checks out under the repository name).
  test('the snapshot lives inside the app, the live graph next to it', () => {
    expect(SNAPSHOT_GRAPH).toBe(join(APP_ROOT, 'graph-snapshot', 'graph.json'))
    expect(LIVE_GRAPH).toBe(join(dirname(APP_ROOT), 'graphify-out', 'graph.json'))
  })
})
