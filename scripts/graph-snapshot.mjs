// The versioned copy of Graphify's graph.json (graph-snapshot/graph.json).
//
//   node scripts/graph-snapshot.mjs status   compares it with ../graphify-out/graph.json
//   node scripts/graph-snapshot.mjs sync     copies ../graphify-out/graph.json over it
//
// graphify-out/ is only ever READ. Graphify is never run from here.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { APP_ROOT, LIVE_GRAPH, SNAPSHOT_GRAPH } from './graph-source.mjs'

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const shown = (file) => relative(APP_ROOT, file)
const command = process.argv[2]

function status() {
  if (!existsSync(SNAPSHOT_GRAPH)) {
    console.error(`${shown(SNAPSHOT_GRAPH)} is missing: run \`npm run graph:sync\` where graphify-out/ exists.`)
    return 1
  }
  const snapshot = sha256(SNAPSHOT_GRAPH)
  if (!existsSync(LIVE_GRAPH)) {
    // A clone or CI: there is no live graph to compare with, the snapshot is the graph.
    console.log(`graph snapshot ${snapshot.slice(0, 12)} (no ${shown(LIVE_GRAPH)} here: nothing to compare)`)
    return 0
  }
  const live = sha256(LIVE_GRAPH)
  if (live !== snapshot) {
    console.error(
      `graph snapshot ${snapshot.slice(0, 12)} differs from ${shown(LIVE_GRAPH)} ${live.slice(0, 12)}.\n` +
        'Graphify produced a new graph: run `npm run graph:sync`, check the app, and commit the snapshot.',
    )
    return 1
  }
  console.log(`graph snapshot ${snapshot.slice(0, 12)} matches ${shown(LIVE_GRAPH)}`)
  return 0
}

function sync() {
  if (!existsSync(LIVE_GRAPH)) {
    console.error(`${shown(LIVE_GRAPH)} not found: the snapshot can only be refreshed where Graphify's output is.`)
    return 1
  }
  mkdirSync(dirname(SNAPSHOT_GRAPH), { recursive: true })
  copyFileSync(LIVE_GRAPH, SNAPSHOT_GRAPH)
  console.log(`${shown(SNAPSHOT_GRAPH)} ← ${shown(LIVE_GRAPH)} (${sha256(SNAPSHOT_GRAPH).slice(0, 12)})`)
  return 0
}

const commands = { status, sync }
if (!(command in commands)) {
  console.error('usage: node scripts/graph-snapshot.mjs status|sync')
  process.exit(2)
}
process.exit(commands[command]())
