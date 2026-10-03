// Verifies that dist/ is a complete, self-contained static site before it is
// tested or published. Run with `npm run check:dist` after a build.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveGraphSource } from './graph-source.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
// The same graph the build read: see graph-source.mjs.
const graphSource = resolveGraphSource().path
const problems = []
const fail = (message) => problems.push(message)
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function listFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

if (!existsSync(dist)) {
  console.error('dist/ does not exist: run `npm run build` first.')
  process.exit(1)
}

const files = listFiles(dist)
const names = files.map((file) => relative(dist, file))

// 1. The three things a host has to serve.
for (const required of ['index.html', 'data/graph.json']) {
  if (!names.includes(required)) fail(`missing ${required}`)
}
if (!names.some((name) => /^assets\/index-.+\.js$/.test(name))) fail('missing the application script in assets/')
if (!names.some((name) => /^assets\/index-.+\.css$/.test(name))) fail('missing the stylesheet in assets/')

// 2. The graph that ships is byte for byte the graph the build read.
if (names.includes('data/graph.json')) {
  if (!existsSync(graphSource)) fail(`graph source not found at ${graphSource}`)
  else if (sha256(join(dist, 'data/graph.json')) !== sha256(graphSource)) {
    fail('dist/data/graph.json differs from the source graph.json: rebuild')
  }
}

// 3. index.html only uses relative URLs, and every file it names exists.
if (names.includes('index.html')) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (url.startsWith('data:')) continue
    if (!url.startsWith('./')) fail(`index.html: "${url}" is not a relative URL`)
    else if (!names.includes(url.slice(2))) fail(`index.html: "${url}" does not exist in dist/`)
  }
}

// 4. Every asset carries a content hash, so it can be cached for good.
for (const name of names.filter((candidate) => candidate.startsWith('assets/'))) {
  if (!/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(name)) fail(`${name}: no content hash in the file name`)
}

// 5. Nothing from development, and nothing secret, in what ships.
const FORBIDDEN = [
  [/https?:\/\/(localhost|127\.0\.0\.1)/, 'a development server address'],
  [/__EOG__/, 'the development handle __EOG__'],
  [/console\.(log|debug)\(/, 'a debugging log'],
  [/\bdebugger\b/, 'a debugger statement'],
  [/sourceMappingURL=/, 'a source map reference'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/, 'an API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
]
for (const file of files) {
  const name = relative(dist, file)
  if (name.endsWith('.map')) fail(`${name}: source maps are not published`)
  if (!/\.(js|css|html)$/.test(name)) continue
  const content = readFileSync(file, 'utf8')
  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(content)) fail(`${name}: contains ${what}`)
  }
  if (name.endsWith('.css') && /url\(\s*["']?(\/|https?:)/.test(content)) {
    fail(`${name}: absolute URL in the stylesheet`)
  }
}

if (problems.length > 0) {
  console.error(`dist/ is not publishable:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
  process.exit(1)
}
const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0)
console.log(`dist/ OK: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, graph.json matches its source.`)
